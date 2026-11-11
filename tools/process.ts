import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Tools re-enter pnpm through the same executable that launched them, on every platform. */
export function pnpmPath(): string {
  const path = process.env.npm_execpath;
  if (!path) throw new Error('Run this tool through a pnpm script.');
  return path;
}

export function releaseVersion(): string {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  return manifest.version;
}

export function run(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed: ${String(code ?? signal)}`));
    });
  });
}

export const runPnpm = (args: readonly string[], options?: Parameters<typeof run>[2]) =>
  run(process.execPath, [pnpmPath(), ...args], options);
