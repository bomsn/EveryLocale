const COMMANDS: Record<string, string> = {
  sync: [
    'Upload every source file matched by everylocale.config.json and queue translation.',
    '',
    '  everylocale sync [--wait] [--timeout 600] [--config path] [--url URL]',
    '',
    '--wait stops with a list of messages that need attention, or when all are approved.',
    'Files deleted locally are withdrawn. Needs a token with import and translate.',
  ].join('\n'),
  pull: [
    'Download approved translations, write a verified release, and render translated files.',
    '',
    '  everylocale pull [--config path] [--url URL]',
    '',
    'Live locales must be fully approved. Draft locales use source text for unapproved',
    'messages and skip unapproved documents; both are listed. Needs the export scope.',
  ].join('\n'),
  import: [
    'Send existing translated files to the service as candidates for review.',
    '',
    '  everylocale import --locale fr-CA [--config path] [--url URL]',
    '',
    'Each message follows its project policy. Rejected entries are listed with the reason.',
  ].join('\n'),
  codegen: [
    'Write the declaration file that types message ids and their values.',
    '',
    '  everylocale codegen [--check] [--config path]',
    '',
    '--check fails when the committed file is out of date, for CI. No network access.',
  ].join('\n'),
  check: [
    'Verify the committed release against the source files without network access.',
    '',
    '  everylocale check [--code src] [--json] [--config path]',
    '',
    'Fails on missing or stale translations in live locales, plural or argument mismatches,',
    'altered release files and, with --code, unknown, dynamic or unused message ids.',
  ].join('\n'),
  rollback: [
    'Point current.json at an earlier verified release.',
    '',
    '  everylocale rollback --revision REVISION [--config path]',
  ].join('\n'),
};

export function help(command?: string): string {
  const selected = command ? COMMANDS[command] : undefined;
  return [
    selected ??
      [
        'EveryLocale keeps your app translated from everylocale.config.json.',
        '',
        `Commands: ${Object.keys(COMMANDS).join(', ')}`,
        'Run everylocale COMMAND --help for its options.',
      ].join('\n'),
    '',
    'Online commands read EVERYLOCALE_URL and a scoped EVERYLOCALE_TOKEN from the environment.',
    'Remote services require HTTPS.',
  ].join('\n');
}
