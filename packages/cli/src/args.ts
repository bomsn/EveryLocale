/** Parsed command line: `everylocale <command> [--name value] [--flag]`. */
export type Args = {
  command: string | undefined;
  option(name: string): string | undefined;
  required(name: string): string;
  flag(name: string): boolean;
  /** Fails on options this command does not accept, so a typo never changes behavior. */
  only(names: readonly string[]): void;
};

export function parseArgs(argv: readonly string[], flags: ReadonlySet<string>): Args {
  const [command, ...rest] = argv;
  const values = new Map<string, string>();
  const seen = new Set<string>();
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index] ?? '';
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    seen.add(name);
    if (flags.has(name)) continue;
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    values.set(name, value);
    index++;
  }
  return {
    command,
    option: (name) => values.get(name),
    required(name) {
      const value = values.get(name);
      if (!value) throw new Error(`--${name} is required`);
      return value;
    },
    flag: (name) => seen.has(name) && flags.has(name),
    only(names) {
      const unknown = [...seen].filter((name) => !names.includes(name) && name !== 'help');
      if (unknown.length) throw new Error(`Unknown option: --${unknown.join(', --')}`);
    },
  };
}
