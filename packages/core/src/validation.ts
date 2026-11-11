import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import * as OpenCCModule from 'opencc-js';
import type { Finding, SourceUnit, GlossaryEntry } from './types.js';
import { localeTraits } from './locales.js';
type Dictionary = string | readonly (readonly [string, string])[];
type OpenCC = {
  Converter(options: { from: string; to: string }): (text: string) => string;
  Locale: { from: Readonly<Record<string, readonly (readonly Dictionary[])[] | undefined>> };
};
// opencc-js 1.4.2 publishes declarations with extensionless relative imports that NodeNext
// resolution cannot follow, so the API this module uses is typed here once.
const OpenCC = OpenCCModule as unknown as OpenCC;
/** Regional Traditional Chinese conventions OpenCC can compare against. */
const regionalConverters: Readonly<Record<string, (text: string) => string>> = {
  TW: OpenCC.Converter({ from: 'cn', to: 'tw' }),
  HK: OpenCC.Converter({ from: 'cn', to: 'hk' }),
};
/** Shared forms occur in legitimate Traditional words; only unequivocal simplified forms block. */
function simplifiedOnlyCharacters() {
  const dictionaries = OpenCC.Locale.from.cn ?? [];
  const entries = dictionaries.flatMap((group) =>
    group.flatMap((dictionary) =>
      typeof dictionary === 'string'
        ? dictionary.split('|').map((row) => row.split(' ') as [string, string])
        : [...dictionary],
    ),
  );
  const traditional = new Set(entries.flatMap(([, target]) => Array.from(target)));
  return new Set(
    entries
      .filter(([source]) => Array.from(source).length === 1 && !traditional.has(source))
      .map(([source]) => source),
  );
}
const simplifiedOnly = simplifiedOnlyCharacters();

function signature(nodes: MessageFormatElement[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.type === TYPE.literal || node.type === TYPE.pound) continue;
    into.add(`${node.type}:${node.value}`);
    if (node.type === TYPE.number || node.type === TYPE.date || node.type === TYPE.time)
      into.add(`style:${node.type}:${node.value}:${JSON.stringify(node.style ?? null)}`);
    if (node.type === TYPE.tag) signature(node.children, into);
    if (node.type === TYPE.select || node.type === TYPE.plural) {
      if (node.type === TYPE.plural)
        into.add(`offset:${node.value}:${node.offset}:${node.pluralType}`);
      for (const [key, option] of Object.entries(node.options)) {
        if (node.type === TYPE.select || key.startsWith('='))
          into.add(`selector:${node.value}:${key}`);
        signature(option.value, into);
      }
    }
  }
  return into;
}
function checkPlural(nodes: MessageFormatElement[], locale: string, findings: Finding[]): void {
  for (const node of nodes) {
    if (node.type === TYPE.tag) checkPlural(node.children, locale, findings);
    if (node.type === TYPE.select || node.type === TYPE.plural) {
      if (node.type === TYPE.plural) {
        for (const category of new Intl.PluralRules(locale, {
          type: node.pluralType,
        }).resolvedOptions().pluralCategories) {
          if (!node.options[category])
            findings.push({
              severity: 'critical',
              code: 'plural_branch',
              message: `Missing ${category} plural branch for ${node.value}.`,
            });
        }
      }
      for (const option of Object.values(node.options)) checkPlural(option.value, locale, findings);
    }
  }
}
export function protectedValues(source: string, terms: string[] = []): string[] {
  return [
    ...terms.filter((x) => source.includes(x)),
    // Locale changes must not imply a currency conversion, even when the numeric amount is zero.
    ...(source.match(/\p{Sc}/gu) ?? []),
    ...(source.match(
      /https?:\/\/[^\s<>"')]+|%(?:\d+\$)?[+#\-0 ]*\d*(?:\.\d+)?[a-zA-Z]|\$\{[^}]+\}|\{\{[^}]+\}\}|\b\d+(?:[.,]\d+)*(?:%|\b)|\[\[EL:[^\]]+\]\]/gu,
    ) ?? []),
  ];
}
export function validateTranslation(
  unit: SourceUnit,
  translation: string,
  locale: string,
  glossary: GlossaryEntry[] = [],
): Finding[] {
  const findings: Finding[] = [];
  if (!translation.trim())
    return [{ severity: 'critical', code: 'empty', message: 'Translation is empty.' }];
  if (translation.length > Math.max(1000, unit.source.length * 8))
    findings.push({
      severity: 'critical',
      code: 'expansion',
      message: 'Unexpected translation size.',
    });
  if (translation.includes('\u0000'))
    findings.push({
      severity: 'critical',
      code: 'control',
      message: 'Null characters are not allowed.',
    });
  const protectedTerms = [
    ...unit.protectedTerms,
    ...glossary.filter((x) => x.keep).map((x) => x.source),
  ];
  const numericSource = unit.kind === 'icu' ? unit.source.replace(/=\d+\s*\{/g, '{') : unit.source;
  const numericTarget = unit.kind === 'icu' ? translation.replace(/=\d+\s*\{/g, '{') : translation;
  for (const value of new Set(protectedValues(numericSource, protectedTerms))) {
    const count = (text: string) => text.split(value).length - 1;
    if (
      unit.kind === 'icu'
        ? count(numericTarget) === 0
        : count(numericTarget) !== count(numericSource)
    )
      findings.push({
        severity: 'critical',
        code: 'protected_value',
        message: `Protected value changed: ${value}`,
      });
  }
  const sourceValues = new Set(protectedValues(numericSource));
  for (const value of new Set(protectedValues(numericTarget)))
    if (!sourceValues.has(value))
      findings.push({
        severity: 'critical',
        code: 'invented_value',
        message: `Unexpected factual value, URL, or placeholder: ${value}`,
      });
  for (const entry of glossary.filter((x) => !x.keep && unit.source.includes(x.source))) {
    const target = entry.targets[locale];
    if (target && !translation.includes(target))
      findings.push({
        severity: 'major',
        code: 'glossary',
        message: `Expected terminology: ${target}`,
      });
  }
  if (unit.kind === 'icu') {
    try {
      const original = signature(parse(unit.source));
      const translated = parse(translation);
      const actual = signature(translated);
      if ([...original].some((x) => !actual.has(x)) || [...actual].some((x) => !original.has(x)))
        findings.push({
          severity: 'critical',
          code: 'icu_structure',
          message: 'ICU arguments, tags, or exact selectors changed.',
        });
      checkPlural(translated, locale, findings);
    } catch {
      findings.push({
        severity: 'critical',
        code: 'icu_parse',
        message: 'Invalid ICU message syntax.',
      });
    }
  }
  const traits = localeTraits(locale);
  if (traits.language === 'zh' && traits.script === 'Hant') {
    const regional = traits.region ? regionalConverters[traits.region] : undefined;
    let text = translation;
    for (const term of protectedTerms) text = text.split(term).join('');
    const simplified = [
      ...new Set(Array.from(text).filter((character) => simplifiedOnly.has(character))),
    ];
    if (simplified.length)
      findings.push({
        severity: 'critical',
        code: 'chinese_script',
        message: `Simplified-only Chinese characters require correction: ${simplified.join('')}`,
      });
    else if (regional && regional(text) !== text)
      findings.push({
        severity: 'minor',
        code: 'chinese_variant',
        message:
          'Chinese conversion suggests a regional variant. Confirm in context; valid Traditional Chinese wording can also differ from the conversion dictionary.',
      });
  }
  return findings;
}
