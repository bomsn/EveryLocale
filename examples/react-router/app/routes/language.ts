import { i18n } from '../i18n.server';
import type { Route } from './+types/language';

/** The language form submits here; it redirects to the chosen locale and remembers it. */
export const loader = (args: Route.LoaderArgs) => i18n.switchLocale(args);
