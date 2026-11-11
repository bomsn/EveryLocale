import { Link } from 'react-router';
import { Message, useMessages } from '@everylocale/react';
import { formatterOf, languageMeta, useLocalizedPath } from '@everylocale/react-router';
import { i18n } from '../i18n.server';
import type { Route } from './+types/home';

export const loader = (args: Route.LoaderArgs) => ({ messages: i18n.messages(args, ['home']) });

export const meta: Route.MetaFunction = ({ matches }) => [
  { title: formatterOf(matches)?.format('app:site') },
  ...languageMeta(matches),
];

const COUNTS = [0, 1, 2, 1_000_000];

export default function Home() {
  const { format } = useMessages();
  const localize = useLocalizedPath();
  return (
    <>
      <h1>
        <Message id="home:heading" values={{ name: 'Ana' }} />
      </h1>
      <p className="overview">
        <Message id="home:overview" />
      </p>
      <ul aria-label={format('home:overview')}>
        {COUNTS.map((count) => (
          <li key={count} data-count={count}>
            {format('home:files', { count })}
          </li>
        ))}
      </ul>
      <p>
        <Message
          id="home:intro"
          values={{
            link: (chunks) => <Link to={localize('/about')}>{chunks}</Link>,
          }}
        />
      </p>
    </>
  );
}
