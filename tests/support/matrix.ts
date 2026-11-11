import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

/**
 * Loaded with `--import` to run the same tests against other React and React Router majors.
 * Every `react`, `react-dom` and `react-router` import, from tests and built packages alike,
 * resolves from EVERYLOCALE_MATRIX_ROOT, so one React instance serves the whole run.
 * EVERYLOCALE_MATRIX_ROUTER names the installed package that stands in for `react-router`.
 */
const root = process.env.EVERYLOCALE_MATRIX_ROOT;
if (!root) throw new Error('EVERYLOCALE_MATRIX_ROOT is required');
const router = process.env.EVERYLOCALE_MATRIX_ROUTER ?? 'react-router';
const parentURL = pathToFileURL(join(resolve(root), 'package.json')).href;
const MAPPED = new Set(['react', 'react-dom', 'react-router']);

registerHooks({
  resolve(specifier, context, next) {
    const [name = '', ...rest] = specifier.split('/');
    if (!MAPPED.has(name)) return next(specifier, context);
    const target = name === 'react-router' ? [router, ...rest].join('/') : specifier;
    return next(target, { ...context, parentURL });
  },
});
