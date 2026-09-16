export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogEntry = { id: string; time: number; source: 'serial' | 'simulator' | 'link'; level: LogLevel; message: string; spans?: { text: string; color?: string; bold?: boolean; dim?: boolean }[] };
export function logLevel(level: string, message = ''): LogLevel {
  const candidate = level.toLowerCase();
  if (candidate === 'error' || candidate === 'warn' || candidate === 'debug') return candidate;
  if (/\bERROR\b|^E \(/.test(message)) return 'error';
  if (/\bWARN\b|^W \(/.test(message)) return 'warn';
  if (/\bDEBUG\b|^D \(/.test(message)) return 'debug';
  return 'info';
}
// Return text, never HTML: device output is untrusted input.
export function cleanLog(message: string): string {
  return message.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '').slice(0, 8192);
}

/** Virtualization counts visual lines, not events (a job error can span lines). */
export function logRows(entries: LogEntry[], limit = 4000): LogEntry[] {
  const result: LogEntry[] = [];
  for (let index = entries.length - 1; index >= 0 && result.length < limit; index--) {
    const entry = entries[index];
    const lines: NonNullable<LogEntry['spans']>[] = [[]];
    for (const span of entry.spans ?? [{ text: entry.message }]) {
      const parts = cleanLog(span.text).split('\n');
      parts.forEach((text, part) => {
        if (part) lines.push([]);
        if (text) lines.at(-1)!.push({ ...span, text });
      });
    }
    for (let line = lines.length - 1; line >= 0 && result.length < limit; line--) {
      const spans = lines[line];
      result.push({ ...entry, id: `${entry.id}:${line}`, message: spans.map(span => span.text).join(''), spans });
    }
  }
  return result.reverse();
}
