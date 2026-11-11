import type { ReactNode } from 'react';
import {
  isRouteErrorResponse,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from 'react-router';
import { LanguageLinks, LanguageSelect, useMessages } from '@everylocale/react';
import {
  EveryLocaleRouterProvider,
  languagePaths,
  useLocaleData,
  useLocalizedPath,
} from '@everylocale/react-router';
import { i18n } from './i18n.server';
import type { Route } from './+types/root';
import stylesheet from './app.css?url';

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: stylesheet }];

/** Resolves the locale once per request; every route renders and hydrates with it. */
export const loader = (args: Route.LoaderArgs) => i18n.root(args, ['app']);

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<typeof loader>('root');
  // Without root data an error boundary is rendering in the source language.
  return (
    <html lang={data?.locale ?? 'en'} dir={data?.direction ?? 'ltr'}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function Shell() {
  const { format } = useMessages();
  const localize = useLocalizedPath();
  const data = useLocaleData();
  if (!data) return null;
  return (
    <>
      <header>
        <p>
          <strong>{format('app:site')}</strong>
        </p>
        <nav aria-label={format('app:navigation')}>
          <ul>
            <li>
              <NavLink to={localize('/')} end>
                {format('app:home')}
              </NavLink>
            </li>
            <li>
              <NavLink to={localize('/about')}>{format('app:about')}</NavLink>
            </li>
          </ul>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        <div className="languages">
          <LanguageLinks
            locale={data.locale}
            locales={data.locales}
            links={languagePaths(data)}
            label={format('app:languages')}
          />
        </div>
        <LanguageSelect
          locale={data.locale}
          locales={data.locales}
          action="/language"
          label={format('app:language')}
          submitLabel={format('app:change')}
          hidden={{ path: data.pathname }}
        />
      </footer>
    </>
  );
}

export default function App() {
  return (
    <EveryLocaleRouterProvider missing="throw">
      <Shell />
    </EveryLocaleRouterProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <main>
      <h1>{status === 404 ? 'Page not found' : 'Something went wrong'}</h1>
    </main>
  );
}
