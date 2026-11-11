import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * One release version, read from the root package.json. Files that cannot read it at runtime
 * (package manifests, the WordPress plugin header, the compose image tag) must state the same
 * value, or a release would build one version and test another.
 */
test('every package, example, the WordPress plugin and the compose image share the release version', async () => {
  const read = async (path: string) => readFile(path, 'utf8');
  const { version } = JSON.parse(await read('package.json')) as { version: string };
  const candidates = ['packages', 'examples'].map(async (root) =>
    (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name, 'package.json')),
  );
  const manifests: string[] = [];
  for (const path of (await Promise.all(candidates)).flat())
    // Examples without a manifest, such as the quickstart files, have no version.
    await access(path).then(
      () => manifests.push(path),
      () => undefined,
    );
  assert.ok(manifests.length >= 10, manifests.join(', '));
  for (const path of manifests)
    assert.equal((JSON.parse(await read(path)) as { version: string }).version, version, path);
  assert.match(
    await read('adapters/wordpress/everylocale/everylocale.php'),
    new RegExp(`^ \\* Version: ${version.replaceAll('.', '\\.')}$`, 'm'),
  );
  assert.match(await read('compose.yaml'), new RegExp(`image: everylocale:${version}\\n`));
});
