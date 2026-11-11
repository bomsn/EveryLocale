/** A logger that records what the worker reports, so tests can assert on it. */
export function recordingLog() {
  const entries: Array<{
    level: 'error' | 'warn';
    fields: Record<string, unknown>;
    message: string;
  }> = [];
  return {
    entries,
    error(fields: Record<string, unknown>, message: string) {
      entries.push({ level: 'error', fields, message });
    },
    warn(fields: Record<string, unknown>, message: string) {
      entries.push({ level: 'warn', fields, message });
    },
  };
}
