import { Message } from '@everylocale/react';
import { formatterOf, languageMeta } from '@everylocale/react-router';
import { i18n } from '../i18n.server';
import type { Route } from './+types/about';

export const loader = (args: Route.LoaderArgs) => ({ messages: i18n.messages(args, ['about']) });

export const meta: Route.MetaFunction = ({ matches }) => [
  { title: formatterOf(matches)?.format('about:heading') },
  ...languageMeta(matches),
];

export default function About() {
  return (
    <>
      <h1>
        <Message id="about:heading" />
      </h1>
      <p>
        <Message id="about:body" />
      </p>
    </>
  );
}
