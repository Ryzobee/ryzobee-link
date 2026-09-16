import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createSimulator } from '../simulator';
import type { SourceError } from './LuaEditor';
import Icon from './Icon';

export default function SimulatorPanel({ source, onLog, onError }: {
  source: string;
  onLog: (level: string, message: string) => void;
  onError: (error: SourceError | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const simulator = useRef<ReturnType<typeof createSimulator> | null>(null);
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  const [runSource, setRunSource] = useState<string | null>(null);
  const executionSource = useRef('');
  const activePointer = useRef<number | null>(null);
  const logCallback = useRef(onLog); logCallback.current = onLog;
  const errorCallback = useRef(onError); errorCallback.current = onError;
  useEffect(() => {
    const runtime = createSimulator({
      onFrame: frame => {
        const context = canvas.current?.getContext('2d');
        if (context) context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
      },
      onState: next => setState(next),
      onLog: event => logCallback.current(event.level, event.message),
      onError: text => {
        setMessage(text);
        errorCallback.current({ source: executionSource.current, message: text, line: Number(text.match(/:(\d+):/)?.[1] ?? 1) });
      },
    });
    simulator.current = runtime;
    return () => { runtime.dispose(); simulator.current = null; };
  }, []);
  const labels: Record<string, string> = { idle: '未运行', loading: '加载中', running: '运行中', stopping: '停止中', error: '运行失败' };
  const active = state === 'running' || state === 'loading';
  async function run() {
    activePointer.current = null;
    executionSource.current = source; setRunSource(source); setMessage(''); onError(null);
    try { await simulator.current?.run(source); }
    catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(text); setState('error'); logCallback.current('error', text);
    }
  }
  function pointer(event: PointerEvent<HTMLCanvasElement>, pressed: boolean, cancel = false) {
    if (state !== 'running') return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = cancel ? -1 : Math.floor((event.clientX - box.left) * 240 / box.width);
    const y = cancel ? -1 : Math.floor((event.clientY - box.top) * 240 / box.height);
    simulator.current?.pointer({ x, y, pressed });
  }
  return <section className="panel simulator-panel" aria-label="UI 模拟器">
    <div className="panel-heading"><h2><Icon name="screen-full" />UI 模拟器</h2><div className="actions">
      <button onClick={() => void run()} disabled={state === 'loading' || state === 'stopping'}>运行</button>
      <button disabled={!active} onClick={() => void simulator.current?.stop().catch(error => setMessage(String(error)))}>停止</button>
    </div></div>
    <div className={`simulator-state ${state === 'running' ? 'success' : state === 'error' ? 'error' : ''}`} role="status">
      <span className="status-dot" />{labels[state] ?? state}{active && runSource !== source ? ' · 源码已修改' : ''}
    </div>
    <div className="device-shell">
      <canvas ref={canvas} width="240" height="240" aria-label="240×240 交互模拟屏幕"
        onPointerDown={event => { if (!event.isPrimary || event.button !== 0 || state !== 'running') return; activePointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); pointer(event, true); }}
        onPointerMove={event => { if (activePointer.current === event.pointerId) pointer(event, true); }}
        onPointerUp={event => { if (activePointer.current !== event.pointerId) return; activePointer.current = null; pointer(event, false); if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={event => { if (activePointer.current !== event.pointerId) return; activePointer.current = null; pointer(event, false, true); }}
        onLostPointerCapture={event => { if (activePointer.current !== event.pointerId) return; activePointer.current = null; pointer(event, false, true); }} />
      {runSource === null && <div className="simulator-empty" aria-hidden="true"><span>RYZOBEE</span><small>240 × 240</small></div>}
    </div>
    {message && <div className="simulator-error" role="alert">{message}</div>}
  </section>;
}
