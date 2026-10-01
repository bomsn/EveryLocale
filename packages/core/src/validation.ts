import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import * as OpenCC from 'opencc-js';
import type { Finding, SourceUnit, GlossaryEntry } from './types.js';

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
  if (/\u0000/.test(translation))
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
  if (locale.startsWith('zh-Hant')) {
    let text = translation;
    for (const term of protectedTerms) text = text.split(term).join('');
    const traditional = OpenCC.Converter({ from: 'cn', to: 'tw' })(text);
    if (traditional !== text)
      findings.push({
        severity: 'major',
        code: 'chinese_script',
        message:
          'Review Simplified Chinese characters or terminology in this Traditional Chinese translation.',
      });
  }
  return findings;
}
