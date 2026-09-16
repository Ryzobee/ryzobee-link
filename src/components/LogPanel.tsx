import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry } from '../workspace/logs';
import { cleanLog, logRows } from '../workspace/logs';
import Icon from './Icon';

const ROW_HEIGHT = 26;
export default function LogPanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState('all');
  const [source, setSource] = useState('all');
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(250);
  const host = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => logRows(logs.filter(row => (level === 'all' || row.level === level) && (source === 'all' || row.source === source))), [logs, level, source]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!paused && host.current) { host.current.scrollTop = host.current.scrollHeight; setScrollTop(host.current.scrollTop); }
  }, [filtered, paused, height]);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const visible = filtered.slice(start, start + Math.ceil(height / ROW_HEIGHT) + 10);
  return <section className="panel logs-panel" aria-label="日志">
    <div className="panel-heading"><h2><Icon name="terminal" />串口日志</h2>
      <select aria-label="日志来源" value={source} onChange={event => setSource(event.target.value)}><option value="all">全部来源</option><option value="serial">设备串口</option><option value="simulator">模拟器</option><option value="link">Link</option></select>
      <div className="actions log-actions"><select aria-label="日志级别" value={level} onChange={event => setLevel(event.target.value)}><option value="all">级别：全部</option>{['debug','info','warn','error'].map(value => <option value={value} key={value}>{value.toUpperCase()}</option>)}</select>
        <button onClick={() => setPaused(value => !value)}>{paused ? '跟随最新' : '暂停滚动'}</button><button onClick={onClear}>清空视图</button></div>
    </div>
    <div className="log-viewport" ref={host} onScroll={event => setScrollTop(event.currentTarget.scrollTop)} tabIndex={0} aria-label="日志内容">
      {filtered.length === 0 ? <div className="empty-state">暂无日志</div> : <div className="log-spacer" style={{ height: filtered.length * ROW_HEIGHT }}><div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
        {visible.map(row => <div key={row.id} className={`log-line ${row.level}`} title={cleanLog(row.message)}><time>{new Date(row.time).toLocaleTimeString('zh-CN', { hour12: false })}</time><span className="log-level">{row.level.toUpperCase()}</span><span className="log-source">[{row.source}]</span><span className="log-text">{row.spans ? row.spans.map((part, index) => <span key={index} style={{ color: part.color, fontWeight: part.bold ? 700 : undefined, opacity: part.dim ? .6 : undefined }}>{cleanLog(part.text)}</span>) : cleanLog(row.message)}</span></div>)}
      </div></div>}
    </div>
    <div className="log-footer"><span className="status-dot" />{paused ? '已暂停滚动 · 仍在接收' : '跟随最新'}<span>{filtered.length} 行</span></div>
  </section>;
}
