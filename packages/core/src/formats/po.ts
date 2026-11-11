import * as gettext from 'gettext-parser';
import { getNPlurals, getFormula, getExamples, hasLang } from 'plural-forms';
import { IntlMessageFormat } from 'intl-messageformat';
import { hash } from '../hash.js';
import { ContractError, type ExtractedDocument, type SourceUnit } from '../types.js';
import { sourceUnit } from './segments.js';
import type { DocumentFormat } from './registry.js';

/** The ICU argument that carries a gettext plural count. */
const COUNT = '__el_count';
const unitId = (namespace: string, context: string, id: string) =>
  `${namespace}:${hash([context, id]).slice(0, 24)}`;

function extract(content: string, namespace: string): ExtractedDocument {
  const data = gettext.po.parse(Buffer.from(content));
  const units: SourceUnit[] = [];
  for (const [context, entries] of Object.entries(data.translations))
    for (const [id, entry] of Object.entries(entries)) {
      if (!id) continue;
      const message = entry.msgid_plural
        ? `{${COUNT}, plural, one {${entry.msgid}} other {${entry.msgid_plural}}}`
        : entry.msgid;
      units.push(
        sourceUnit(
          unitId(namespace, context, id),
          message,
          entry.msgid_plural ? 'icu' : 'text',
          context,
        ),
      );
    }
  return {
    format: 'po',
    content,
    units,
    render(translations, locale) {
      const copy = gettext.po.parse(Buffer.from(content));
      copy.headers.Language = locale;
      const language = new Intl.Locale(locale).language;
      if (!hasLang(language))
        throw new ContractError(
          'po_locale',
          `Gettext plural rules are unavailable for ${locale}`,
          422,
        );
      const forms = getNPlurals(language);
      copy.headers['Plural-Forms'] = `nplurals=${forms}; plural=${getFormula(language)};`;
      for (const [context, entries] of Object.entries(copy.translations))
        for (const [id, entry] of Object.entries(entries)) {
          if (!id) continue;
          const key = unitId(namespace, context, id);
          const translated = translations[key];
          if (translated === undefined)
            throw new ContractError('missing_translation', `Missing ${key}`);
          if (entry.msgid_plural) {
            const formatter = new IntlMessageFormat(translated, locale);
            const msgstr = Array.from({ length: forms }, () => '');
            for (const example of getExamples(language))
              msgstr[example.plural] = String(formatter.format({ [COUNT]: example.sample }));
            if (msgstr.some((form) => !form))
              throw new ContractError('po_plural', 'Missing translated plural form', 422);
            entry.msgstr = msgstr;
          } else entry.msgstr = [translated];
          if (entry.comments?.flag)
            entry.comments.flag = entry.comments.flag
              .split(',')
              .filter((flag) => flag.trim() !== 'fuzzy')
              .join(',');
        }
      return gettext.po.compile(copy).toString('utf8');
    },
  };
}

export const poFormat: DocumentFormat = {
  id: 'po',
  extract: (content, { namespace }) => extract(content, namespace),
};
