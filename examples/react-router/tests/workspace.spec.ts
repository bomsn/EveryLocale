import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** The service that `pnpm test:browser` at the repository root starts for this run. */
const url = process.env.EVERYLOCALE_WORKSPACE_URL;
const token = process.env.EVERYLOCALE_ADMIN_TOKEN;

test('the translation workspace has no accessibility violations, signed out or in', async ({
  page,
}) => {
  test.skip(!url || !token, 'Run through pnpm test:browser at the repository root');
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  const violations = async () =>
    (await new AxeBuilder({ page }).analyze()).violations.map(
      (violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' ')}`,
    );
  await page.goto(url ?? '');
  await expect(page.getByLabel('Workspace access token')).toBeVisible();
  expect(await violations()).toEqual([]);
  await page.getByLabel('Workspace access token').fill(token ?? '');
  await page.getByLabel('Workspace access token').press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Localization, without the friction.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your languages' })).toBeVisible();
  expect(await violations()).toEqual([]);
  await page
    .getByRole('button', { name: /Review/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Translation review' })).toBeVisible();
  expect(await violations()).toEqual([]);
  expect(problems).toEqual([]);
});
