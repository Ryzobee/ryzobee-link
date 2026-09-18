import { cleanLog, logLevel, type LogEntry } from '../workspace/logs';

/** UI and commands share the same bounded local log stream, even after UI clearing. */
export class CommandLogs {
  private rows: (LogEntry & { sequence: number; runId?: string })[] = [];
  private sequence = 0;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.rows;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  add(source: LogEntry['source'], level: string, message: string, runId?: string) {
    const sequence = ++this.sequence;
    this.rows = [...this.rows, { id: `local-${sequence}`, sequence, time: Date.now(), source, level: logLevel(level, message), message: cleanLog(message), runId }].slice(-500);
    for (const listener of this.listeners) listener();
  }
}
