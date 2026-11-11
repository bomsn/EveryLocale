import { resolve } from 'node:path';
import { run } from './process.ts';

/**
 * The root test run uses React 18 and React Router 7. This runs the React and React Router
 * tests again on React 19 with React Router 7 and with React Router 8, using the versions the
 * React Router example installs.
 */
const root = resolve('examples/react-router');
const files = ['tests/runtime.test.ts', 'tests/react-ssr.test.ts', 'tests/react-router.test.ts'];
const combinations = [
  { name: 'React 19, React Router 7', router: 'react-router', expect: 'react-router@7.' },
  { name: 'React 19, React Router 8', router: 'react-router-v8', expect: 'react-router@8.' },
];
for (const combination of combinations) {
  console.log(`\n${combination.name}`);
  const env = {
    ...process.env,
    EVERYLOCALE_MATRIX_ROOT: root,
    EVERYLOCALE_MATRIX_ROUTER: combination.router,
  };
  const hooks = ['--experimental-strip-types', '--import', './tests/support/matrix.ts'];
  // Fails the run if the hooks did not take effect, so a silent fallback cannot pass.
  const probe = [
    "const { version } = await import('react');",
    "if (!version.startsWith('19.')) throw new Error('React ' + version);",
    "const router = import.meta.resolve('react-router');",
    `if (!router.includes('${combination.expect}')) throw new Error(router);`,
  ].join('\n');
  await run(process.execPath, [...hooks, '--input-type=module', '-e', probe], { env });
  await run(process.execPath, [...hooks, '--test', ...files], { env });
}
