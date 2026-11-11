#!/usr/bin/env node
import { parseArgs } from './args.js';
import { createApi } from './api.js';
import { help } from './help.js';
import { openWorkspace } from './project.js';
import { activate } from './release.js';
import { sync } from './commands/sync.js';
import { pull } from './commands/pull.js';
import { importTranslations } from './commands/import.js';
import { codegen } from './commands/codegen.js';
import { check, formatReport } from './commands/check.js';

const FLAGS: ReadonlySet<string> = new Set(['wait', 'check', 'json', 'help']);
const log = (line: string) => {
  console.log(line);
};

async function main(argv: readonly string[]) {
  if (argv[0] === 'help' || argv.length === 0) {
    log(help(argv[1]));
    return;
  }
  const args = parseArgs(argv, FLAGS);
  if (args.flag('help')) {
    log(help(args.command));
    return;
  }
  const workspace = () => openWorkspace(args.option('config'));
  const api = () => createApi(process.env, args.option('url'));
  switch (args.command) {
    case 'sync': {
      args.only(['wait', 'timeout', 'config', 'url']);
      const timeoutSeconds = Number(args.option('timeout') ?? 600);
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 86400)
        throw new Error('--timeout must be between 1 and 86400 seconds');
      await sync(api(), await workspace(), { wait: args.flag('wait'), timeoutSeconds, log });
      return;
    }
    case 'pull': {
      args.only(['config', 'url']);
      const summary = await pull(api(), await workspace());
      log(
        `Activated release ${summary.revision} and wrote ${String(summary.written.length)} files.`,
      );
      for (const item of summary.partial)
        log(`  ${item.path}: ${String(item.missing)} messages use source text until approved`);
      for (const item of summary.skipped)
        log(`  ${item.path}: not written; ${String(item.missing)} segments are not approved yet`);
      return;
    }
    case 'import': {
      args.only(['locale', 'config', 'url']);
      const summary = await importTranslations(api(), await workspace(), args.required('locale'));
      log(
        `Imported ${String(summary.imported)} translations; ${String(summary.unchanged)} were unchanged.`,
      );
      for (const item of summary.unmatched) log(`  ${item.path}: ${item.reason}`);
      for (const item of summary.rejected) log(`  ${item.unitId}: ${item.reason}`);
      if (summary.rejected.length || summary.unmatched.length) process.exitCode = 1;
      return;
    }
    case 'codegen': {
      args.only(['check', 'config']);
      const path = await codegen(await workspace(), args.flag('check'));
      log(args.flag('check') ? `${path} is up to date.` : `Wrote ${path}.`);
      return;
    }
    case 'check': {
      args.only(['code', 'json', 'config']);
      const report = await check(await workspace(), { code: args.option('code') });
      log(args.flag('json') ? JSON.stringify(report, null, 2) : formatReport(report));
      if (report.problems.length) process.exitCode = 1;
      return;
    }
    case 'rollback': {
      args.only(['revision', 'config']);
      const revision = args.required('revision');
      await activate(await workspace(), revision);
      log(`Activated release ${revision}.`);
      return;
    }
    default:
      throw new Error(`Unknown command: ${args.command}. Run everylocale help.`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Command failed');
  process.exitCode = 1;
});
