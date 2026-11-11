import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractCode } from '../packages/cli/dist/extract-code.js';
import { sourceHash } from '../packages/core/dist/index.js';

const page = `import { Message, defineMessages } from '@everylocale/react';
export const messages = defineMessages({
  title: { id: 'home:title', defaultMessage: 'Home', description: 'Page heading' },
});
export const Page = ({ id }: { id: 'home:a' | 'home:b' }) => (
  <>
    <Message id="home:welcome" defaultMessage="Welcome, {name}" values={{ name: 'Sam' }} />
    <Message id={id} />
  </>
);
`;

async function checkout(content: string) {
  const root = await mkdtemp(join(tmpdir(), 'everylocale-code-'));
  await mkdir(join(root, 'src', 'app'), { recursive: true });
  await writeFile(join(root, 'src', 'app', 'page.tsx'), content);
  return root;
}
const extractFrom = (root: string) =>
  extractCode([join(root, 'src', 'app', 'page.tsx')], join(root, 'src'));

test('code extraction is identical across checkouts and keeps file paths out of source revisions', async () => {
  const [first, second] = await Promise.all([checkout(page), checkout(page)]);
  try {
    const left = await extractFrom(first);
    const right = await extractFrom(second);
    assert.deepEqual(
      left.map((unit) => [unit.id, unit.context]),
      [
        ['home:title', 'Page heading'],
        ['home:welcome', ''],
      ],
    );
    assert.deepEqual(left.map(sourceHash), right.map(sourceHash));
  } finally {
    await Promise.all([first, second].map((root) => rm(root, { recursive: true, force: true })));
  }
});

test('a declaration that cannot be extracted fails with its file and line', async () => {
  const root = await checkout(
    'const key = \'home:x\';\nexport const A = () => <Message id={key} defaultMessage="Hi" />;\n',
  );
  try {
    await assert.rejects(
      extractFrom(root),
      /app\/page\.tsx:2: id, defaultMessage and description must be string literals/,
    );
    await writeFile(
      join(root, 'src', 'app', 'page.tsx'),
      '<Message id="a:b" defaultMessage="One" />;\n<Message id="a:b" defaultMessage="Two" />;\n',
    );
    await assert.rejects(
      extractFrom(root),
      /page\.tsx:2: a:b is declared with a different default message/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
