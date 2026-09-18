import { createSimulator, type Simulator, type SimulatorFrame, type SimulatorState } from './index';
import { describeFault, type SimulatorFault } from './fault';
import type { SourceError } from '../components/LuaEditor';

export type SimulatorSnapshot = {
  state: SimulatorState;
  fault: SimulatorFault | null;
  source: string;
  sourceName: string;
  runId: string | null;
  frameRevision: number;
};
export type SimulatorLog = { level: 'info' | 'error'; message: string; runId: string };

/** One simulation shared by the visible canvas and browser commands. */
export class SimulatorSession {
  private snapshot: SimulatorSnapshot = { state: 'idle', fault: null, source: '', sourceName: '', runId: null, frameRevision: 0 };
  private runtime: Simulator | null = null;
  private frame: SimulatorFrame | null = null;
  private generation = 0;
  private listeners = new Set<() => void>();
  private frameListeners = new Set<(frame: SimulatorFrame) => void>();
  private logListeners = new Set<(log: SimulatorLog) => void>();
  private errorListeners = new Set<(error: SourceError | null) => void>();

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  onFrame(listener: (frame: SimulatorFrame) => void) {
    this.frameListeners.add(listener);
    if (this.frame) listener(this.frame);
    return () => { this.frameListeners.delete(listener); };
  }
  onLog(listener: (log: SimulatorLog) => void) {
    this.logListeners.add(listener);
    return () => { this.logListeners.delete(listener); };
  }
  onError(listener: (error: SourceError | null) => void) {
    this.errorListeners.add(listener);
    return () => { this.errorListeners.delete(listener); };
  }

  private publish(patch: Partial<SimulatorSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private reportError(message: string, phase = 'runtime') {
    const fault = describeFault(message, phase, this.snapshot.sourceName);
    this.publish({ fault, state: 'error' });
    const error = { source: this.snapshot.source, message: fault.limitation ? fault.summary : message,
      diagnostic: message, limitation: fault.limitation, line: fault.line };
    for (const listener of this.errorListeners) listener(error);
  }

  async run(source: string, sourceName: string, guard?: () => void): Promise<{ runId: string; state: SimulatorState }> {
    guard?.();
    const generation = ++this.generation;
    const runId = crypto.randomUUID();
    const previous = this.runtime;
    if (previous) {
      if (this.snapshot.state === 'running' || this.snapshot.state === 'loading') this.publish({ state: 'stopping' });
      await previous.stop();
      previous.dispose();
    }
    if (generation !== this.generation) throw new Error('模拟器启动已取消');
    this.runtime = null;
    try { guard?.(); }
    catch (error) { this.publish({ state: 'idle' }); throw error; }
    this.frame = null;
    this.publish({ state: 'loading', fault: null, source, sourceName, runId, frameRevision: 0 });
    for (const listener of this.errorListeners) listener(null);
    const current = () => generation === this.generation;
    const runtime = createSimulator({
      onFrame: frame => {
        if (!current()) return;
        this.frame = frame;
        this.publish({ frameRevision: this.snapshot.frameRevision + 1 });
        for (const listener of this.frameListeners) listener(frame);
      },
      onLog: log => { if (current()) for (const listener of this.logListeners) listener({ ...log, runId }); },
      onState: state => { if (current()) this.publish({ state }); },
      onError: (message, phase) => { if (current()) this.reportError(message, phase); },
    });
    this.runtime = runtime;
    try { await runtime.run(source); }
    catch (error) {
      if (current()) {
        runtime.dispose();
        this.reportError(error instanceof Error ? error.message : String(error), 'init');
      }
      throw error;
    }
    if (!current()) throw new Error('模拟器启动已取消');
    // Worker startup is accepted here; running/error/idle arrive asynchronously.
    return { runId, state: this.snapshot.state };
  }

  async stop(): Promise<void> {
    const generation = ++this.generation;
    const runtime = this.runtime;
    if (!runtime) return;
    if (this.snapshot.state === 'running' || this.snapshot.state === 'loading') this.publish({ state: 'stopping' });
    await runtime.stop();
    runtime.dispose();
    if (generation !== this.generation) return;
    this.runtime = null;
    this.publish({ state: 'idle' });
  }

  pointer(input: { x: number; y: number; pressed: boolean }) {
    if (this.snapshot.state !== 'running') return;
    this.runtime?.pointer(input);
  }

  capture(): { runId: string; sourceName: string; state: SimulatorState; width: 240; height: 240; dataUrl: string } {
    if (!this.frame || !this.snapshot.runId) throw new Error('模拟器尚无可读取的画面，请运行脚本并等待首帧');
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 240;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法导出模拟器画面');
    context.putImageData(new ImageData(new Uint8ClampedArray(this.frame.pixels), 240, 240), 0, 0);
    return { runId: this.snapshot.runId, sourceName: this.snapshot.sourceName, state: this.snapshot.state,
      width: 240, height: 240, dataUrl: canvas.toDataURL('image/png') };
  }

  clearFault() {
    this.publish({ fault: null, ...(this.snapshot.state === 'error' ? { state: 'idle' as const } : {}) });
    for (const listener of this.errorListeners) listener(null);
  }

  dispose() {
    ++this.generation;
    this.runtime?.dispose();
    this.runtime = null;
    this.frame = null;
    this.publish({ state: 'idle', fault: null, frameRevision: 0 });
  }
}
