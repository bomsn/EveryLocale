declare module 'plural-forms' {
  export function getNPlurals(locale: string): number;
  export function getFormula(locale: string): string;
  export function getExamples(locale: string): Array<{ plural: number; sample: number }>;
  export function hasLang(locale: string): boolean;
}
