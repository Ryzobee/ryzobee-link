import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { createSimulator } from '../simulator';
import type { SourceError } from './LuaEditor';
import Icon from './Icon';
import SimulatorFaultScreen from './SimulatorFaultScreen';
import { describeFault, type SimulatorFault } from '../simulator/fault';
import { shortcutAria, shortcutLabel } from '../workspace/shortcuts';

export default function SimulatorPanel({ source, sourceName, onLog, onError, onShowLogs, toggleRef, hasDocument = true }: {
  toggleRef?: RefObject<HTMLButtonElement | null>;
  source: string;
  sourceName: string;
  onShowLogs: () => void;
  hasDocument?: boolean;
  onLog: (level: string, message: string) => void;
  onError: (error: SourceError | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const simulator = useRef<ReturnType<typeof createSimulator> | null>(null);
  const [state, setState] = useState('idle');
  const [fault, setFault] = useState<SimulatorFault | null>(null);
  const executionSource = useRef('');
  const executionName = useRef('');
  const activePointer = useRef<number | null>(null);
  const actionPending = useRef(false);
  const logCallback = useRef(onLog); logCallback.current = onLog;
  const errorCallback = useRef(onError); errorCallback.current = onError;
  function reportFault(message: string, phase = 'runtime') {
    const next = describeFault(message, phase, executionName.current);
    setFault(next);
    errorCallback.current({ source: executionSource.current, message: next.limitation ? next.summary : message, diagnostic: message, limitation: next.limitation, line: next.line });
  }
  useEffect(() => {
    const runtime = createSimulator({
      onFrame: frame => {
        const context = canvas.current?.getContext('2d');
        if (context) context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
      },
      onState: next => setState(next),
      onLog: event => logCallback.current(event.level, event.message),
      onError: reportFault,
    });
    simulator.current = runtime;
    return () => { runtime.dispose(); simulator.current = null; };
  }, []);
  const labels: Record<string, string> = { idle: '未运行', loading: '加载中', running: '运行中', stopping: '停止中', error: fault?.limitation ? '无法模拟' : '运行失败' };
  const running = state === 'running';
  const transitioning = state === 'loading' || state === 'stopping';
  const actionLabel = transitioning ? labels[state] : running ? '停止' : '运行';
  async function run() {
    if (!hasDocument) return;
    activePointer.current = null;
    executionSource.current = source; executionName.current = sourceName;
    setFault(null); onError(null);
    canvas.current?.getContext('2d')?.clearRect(0, 0, 240, 240);
    try { await simulator.current?.run(source); }
    catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      reportFault(text, 'init'); setState('error');
    }
  }
  async function toggle() {
    if (actionPending.current || transitioning || (!running && !hasDocument)) return;
    actionPending.current = true;
    // Reflect the transition before the runtime's first asynchronous callback.
    setState(running ? 'stopping' : 'loading');
    try {
      if (running) {
        activePointer.current = null;
        await simulator.current?.stop();
      } else await run();
    } catch (error) {
      reportFault(String(error), 'init');
      setState('error');
    } finally { actionPending.current = false; }
  }
  function pointer(event: PointerEvent<HTMLCanvasElement>, pressed: boolean, cancel = false) {
    if (state !== 'running') return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = cancel ? -1 : Math.floor((event.clientX - box.left) * 240 / box.width);
    const y = cancel ? -1 : Math.floor((event.clientY - box.top) * 240 / box.height);
    simulator.current?.pointer({ x, y, pressed });
  }
  return <section className="panel simulator-panel" aria-label="UI 模拟器">
    <div className="panel-heading"><h2><Icon name="screen-full" />模拟器</h2><div className="actions simulator-controls">
      <div className={`simulator-state ${state === 'running' ? 'success' : state === 'error' ? fault?.limitation ? 'warning' : 'error' : ''}`} role="status" title={labels[state] ?? state}>
        <span className="status-dot" /><span className="simulator-state-text">{labels[state] ?? state}</span>
      </div>
      <button ref={toggleRef} className="simulator-toggle" aria-label={actionLabel} aria-keyshortcuts={shortcutAria('simulate')} aria-busy={transitioning} title={`${!hasDocument && !running && !transitioning ? '先打开或新建 Lua 文件' : actionLabel}（${shortcutLabel('simulate')}）`}
        onClick={() => void toggle()} disabled={transitioning || (!running && !hasDocument)}>
        <Icon name={transitioning ? 'loading' : running ? 'debug-stop' : 'play'} />
      </button>
    </div></div>
    <div className="simulator-stage"><div className="device-shell">
      <img className="device-frame" src="./device/rootmaker-frame.svg" alt="" aria-hidden="true" draggable={false} />
      <div className="device-screen">
      <canvas ref={canvas} width="240" height="240" aria-label="240×240 交互模拟屏幕"
        onPointerDown={event => { if (!event.isPrimary || event.button !== 0 || state !== 'running') return; activePointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); pointer(event, true); }}
        onPointerMove={event => { if (activePointer.current === event.pointerId) pointer(event, true); }}
        onPointerUp={event => { if (activePointer.current !== event.pointerId) return; activePointer.current = null; pointer(event, false); if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={event => { if (activePointer.current !== event.pointerId) return; activePointer.current = null; pointer(event, false, true); }}
        onLostPointerCapture={event => { if (activePointer.current !== event.pointerId) return; activePointer.current = null; pointer(event, false, true); }} />
      {state === 'idle' && <div className="simulator-empty" aria-hidden="true"><img src="./device/simulator-boot.svg" alt="" draggable={false} /><span>SIMULATOR</span></div>}
      {state === 'error' && fault && <SimulatorFaultScreen fault={fault} onHome={() => { setFault(null); setState('idle'); }} onLogs={onShowLogs} />}
      </div>
    </div></div>
  </section>;
}
