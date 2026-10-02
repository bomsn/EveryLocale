const commands: Record<string, string> = {
  extract:
    'Read a document into source segments. No model requests.\n\npnpm cli extract --input examples/messages.json --format json --namespace messages --output source.json\n\nFormats: json, yaml, po, markdown, mdx, html. Keep the namespace stable across edits. Optional: --source-locale en.',
  'extract-code':
    'Read explicit message declarations from TypeScript/React files.\n\npnpm cli extract-code --input ../my-app/src --output source.json\n\nOptional: --source-locale en. Arbitrary strings are not extracted.',
  sync: 'Import sources and queue translation for an existing project.\n\npnpm cli sync --project first-app --input source.json --locales de --wait --timeout 600\n\nComma-separate target locales. --wait stops on blocked/failed work. --import-only imports without model requests.',
  export:
    'Download one approved language catalog.\n\npnpm cli export --project first-app --locale de --output locales/de.catalog.json\n\nRequires current approvals. --allow-stale deliberately permits prior approved wording.',
  pull: 'Download all configured languages as one complete approved release.\n\npnpm cli pull --project first-app --output locales\n\nRead current.json once; its revision identifies releases/REVISION/. Optional: --allow-stale.',
  render:
    'Produce a translated document in its original format from an approved catalog.\n\npnpm cli render --input examples/messages.json --format json --namespace messages --catalog locales/de.catalog.json --output locales/de.json\n\nUse the extraction namespace. The catalog identifies the source and target languages.',
  check:
    'Validate a catalog against current source segments.\n\npnpm cli check --input source.json --catalog locales/de.catalog.json',
  rollback:
    'Activate a retained complete release after verifying its files.\n\npnpm cli rollback --output locales --revision PREVIOUS_REVISION',
};
export function help(command?: string): string {
  const selected = command && commands[command];
  return (
    (selected ||
      'EveryLocale: prepare translations before your app release.\n\nStart: docs/GETTING-STARTED.md\nConnect an app: docs/CONNECT.md\nCommand reference: docs/CLI.md\n\nCommands: extract, extract-code, sync, export, pull, render, check, rollback\nUse pnpm cli COMMAND --help for an example.') +
    '\n\nOnline commands use EVERYLOCALE_URL and a scoped EVERYLOCALE_TOKEN from your environment. Remote services require HTTPS.'
  );
}
