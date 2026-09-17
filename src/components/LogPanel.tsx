import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LogEntry } from '../workspace/logs';
import { cleanLog, logRows } from '../workspace/logs';

const ROW_HEIGHT = 26;
const SOURCES = [
  { value: 'all', label: '全部' },
  { value: 'serial', label: '设备串口' },
  { value: 'simulator', label: '模拟器' },
  { value: 'link', label: 'Link' },
] as const;
type Source = typeof SOURCES[number]['value'];
export default function LogPanel({ logs, onClear, revealLink = 0 }: { logs: LogEntry[]; onClear: () => void; revealLink?: number }) {
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState('all');
  const [source, setSource] = useState<Source>('all');
  const tabsId = useId();
  const tabs = useRef<Partial<Record<Source, HTMLButtonElement | null>>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(250);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!revealLink) return;
    setSource('link'); setLevel('all'); setPaused(false);
    if (host.current) host.current.scrollLeft = 0;
    host.current?.focus({ preventScroll: true });
    host.current?.closest('.logs-panel')?.scrollIntoView({ block: 'nearest' });
  }, [revealLink]);
  const filtered = useMemo(() => logRows(logs.filter(row => (level === 'all' || row.level === level) && (source === 'all' || row.source === source))), [logs, level, source]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!paused && host.current) { host.current.scrollTop = host.current.scrollHeight; setScrollTop(host.current.scrollTop); }
  }, [filtered, paused, height, revealLink]);
  function resetScroll() {
    if (host.current) { host.current.scrollTop = 0; host.current.scrollLeft = 0; }
    setScrollTop(0);
  }
  function selectSource(next: Source) {
    if (next === source) return;
    resetScroll(); setSource(next);
  }
  const start = Math.max(0, Math.min(Math.floor(scrollTop / ROW_HEIGHT) - 5, filtered.length - Math.ceil(height / ROW_HEIGHT)));
  const visible = filtered.slice(start, start + Math.ceil(height / ROW_HEIGHT) + 10);
  return <section className="panel logs-panel" aria-label="日志">
    <div className="panel-heading"><h2 className="visually-hidden">日志</h2>
      <div className="log-source-tabs" role="tablist" aria-label="日志来源">
        {SOURCES.map((item, index) => <button key={item.value} ref={element => { tabs.current[item.value] = element; }}
          type="button" role="tab" id={`${tabsId}-${item.value}`} aria-controls={`${tabsId}-content`}
          aria-selected={source === item.value} tabIndex={source === item.value ? 0 : -1}
          onClick={() => selectSource(item.value)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % SOURCES.length
              : event.key === 'ArrowLeft' ? (index + SOURCES.length - 1) % SOURCES.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? SOURCES.length - 1 : null;
            if (next === null) return;
            event.preventDefault(); selectSource(SOURCES[next].value); tabs.current[SOURCES[next].value]?.focus();
          }}>{item.label}</button>)}
      </div>
      <div className="actions log-actions"><div className="log-filter"><span className="log-count">{filtered.length} 行</span><select aria-label="日志级别" value={level} onChange={event => { resetScroll(); setLevel(event.target.value); }}><option value="all">级别：全部</option>{['debug','info','warn','error'].map(value => <option value={value} key={value}>{value.toUpperCase()}</option>)}</select></div>
        <button onClick={() => setPaused(value => !value)}>{paused ? '继续滚动' : '暂停滚动'}</button><button onClick={onClear}>清空视图</button></div>
    </div>
    <div className="log-viewport" ref={host} onScroll={event => setScrollTop(event.currentTarget.scrollTop)} tabIndex={0} role="tabpanel" id={`${tabsId}-content`} aria-labelledby={`${tabsId}-${source}`}>
      {filtered.length === 0 ? <div className="empty-state">暂无日志</div> : <div className="log-spacer" style={{ height: filtered.length * ROW_HEIGHT }}><div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
        {visible.map(row => <div key={row.id} className={`log-line ${row.level}`} title={cleanLog(row.message)}><time>{new Date(row.time).toLocaleTimeString('zh-CN', { hour12: false })}</time><span className="log-level">{row.level.toUpperCase()}</span><span className="log-source">[{row.source}]</span><span className="log-text">{row.spans ? row.spans.map((part, index) => <span key={index} style={{ color: part.color, fontWeight: part.bold ? 700 : undefined, opacity: part.dim ? .6 : undefined }}>{cleanLog(part.text)}</span>) : cleanLog(row.message)}</span></div>)}
      </div></div>}
    </div>
  </section>;
}
