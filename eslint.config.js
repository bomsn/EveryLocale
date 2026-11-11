import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      'artifacts/**',
      'data/**',
      'test-results/**',
      'docs/**',
      'packages/react/src/flags.ts',
      'tools/import-benchmark.ts',
      // Plain browser JavaScript has no type information for these rules; the workspace
      // script is linted once it is TypeScript.
      'packages/server/public/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Template literals interpolate numbers and URLs deliberately in messages and paths.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // `() => assert.throws(...)` and `() => store.close()` are the idiomatic callback forms.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['test', 'describe', 'it', 'suite'] },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/server/src/app.ts', 'packages/server/src/routes/**/*.ts'],
    rules: {
      // Fastify treats an async handler's resolved value as the response body.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['packages/react/src/**/*.tsx', 'examples/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: { ...reactHooks.configs.recommended.rules, ...jsxA11y.flatConfigs.strict.rules },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Tests assert on parsed JSON from real HTTP responses.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
