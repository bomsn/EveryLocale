import { index, prefix, route, type RouteConfig } from '@react-router/dev/routes';

/** Every page lives under an optional locale prefix: `/about`, `/de/about`, `/zh-tw/about`. */
export default [
  ...prefix(':locale?', [index('routes/home.tsx'), route('about', 'routes/about.tsx')]),
  route('language', 'routes/language.ts'),
] satisfies RouteConfig;
