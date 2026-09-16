import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DeviceClient } from './device';
import type { DeviceFile } from './device/types';
import LuaEditor, { type SourceError } from './components/LuaEditor';
import SimulatorPanel from './components/SimulatorPanel';
import LogPanel from './components/LogPanel';
import Modal from './components/Modal';
import Icon from './components/Icon';
import { downloadLua, loadDraft, saveDraft } from './workspace/drafts';
import { exampleSource } from './workspace/example';
import { logLevel, type LogEntry } from './workspace/logs';

type DraftContent = { name: string; source: string };
type Confirm = { kind: 'upload'; draft: DraftContent; previousSha: string; exists: boolean }
  | { kind: 'delete'; name: string; sha: string }
  | { kind: 'replace'; draft: DraftContent; deviceBoot?: string };
const byteCount = (source: string) => new TextEncoder().encode(source).length;
const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
const connectionLabels = { disconnected: '未连接', connecting: '连接中', 'serial-open': '识别中', ready: '已连接' };

export default function App() {
  const [device] = useState(() => new DeviceClient());
  const snapshot = useSyncExternalStore(device.subscribe, device.getSnapshot);
  const [draft, setDraft] = useState<DraftContent>({ name: 'ui_demo.lua', source: exampleSource });
  const [editorRevision, setEditorRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedDraft, setSavedDraft] = useState<DraftContent | null>(null);
  const [selected, setSelected] = useState('');
  const [menu, setMenu] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [runAfterSend, setRunAfterSend] = useState(false);
  const [sourceError, setSourceError] = useState<SourceError | null>(null);
  const [lastUpload, setLastUpload] = useState<(DraftContent & { boot: string }) | null>(null);
  const [localLogs, setLocalLogs] = useState<LogEntry[]>([]);
  const [clearedSerialId, setClearedSerialId] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveQueue = useRef(Promise.resolve());
  const ready = snapshot.connection === 'ready';
  const serialSupported = 'serial' in navigator && window.isSecureContext;
  const addLog = useCallback((source: LogEntry['source'], level: string, message: string) => {
    setLocalLogs(rows => [...rows, { id: crypto.randomUUID(), time: Date.now(), source, level: logLevel(level, message), message: message.slice(0, 8192) }].slice(-500));
  }, []);
  const simulatorLog = useCallback((level: string, message: string) => addLog('simulator', level, message), [addLog]);
  const logs = useMemo(() => [...localLogs, ...snapshot.logs.filter(row => row.id > clearedSerialId).map(row => ({
    id: `serial-${row.id}`, time: row.time, source: 'serial' as const, level: logLevel(row.kind, row.text), message: row.text, spans: row.spans,
  }))].sort((a, b) => a.time - b.time).slice(-1200), [localLogs, snapshot.logs, clearedSerialId]);

  useEffect(() => {
    let mounted = true;
    void loadDraft().then(stored => { if (mounted && stored) { setDraft(stored); setSavedDraft(stored); setSaved(true); } })
      .catch(() => { if (mounted) setNotice({ text: '浏览器草稿存储不可用，请导出文件保存。', error: true }); })
      .finally(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; void device.disconnect(); };
  }, [device]);
  useEffect(() => {
    if (!loaded) return;
    setSaved(false);
    let current = true;
    const timer = setTimeout(() => {
      saveQueue.current = saveQueue.current.catch(() => {}).then(() => saveDraft({ ...draft, updatedAt: Date.now() }));
      void saveQueue.current.then(() => { if (current) { setSaved(true); setSavedDraft(draft); } })
        .catch(() => { if (current) setNotice({ text: '草稿保存失败，请导出文件到电脑。', error: true }); });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [draft, loaded]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (!saved) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [saved]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void Promise.all([device.list(), device.storage()]).catch(error => {
      if (active) setNotice({ text: `设备已连接，读取文件失败：${String(error)}`, error: true });
    });
    return () => { active = false; };
  }, [device, ready, snapshot.info?.boot_id]);
  async function refreshFilesAfterMutation() {
    try { await device.list(); await device.storage(); }
    catch (error) { addLog('link', 'warn', `设备操作已完成，列表刷新失败：${String(error)}`); }
  }
  const perform = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true); setNotice(null); setMenu('');
    try {
      await action();
      if (success) { setNotice({ text: success, error: false }); addLog('link', 'info', success); }
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setNotice({ text, error: true }); addLog('link', 'error', text); return false;
    } finally { setBusy(false); }
  };
  function replace(next: DraftContent, deviceBoot?: string) {
    setDraft(next); setSourceError(null); setConfirm(null);
    setEditorRevision(revision => revision + 1);
    setLastUpload(deviceBoot ? { ...next, boot: deviceBoot } : null);
  }
  function requestReplace(next: DraftContent, deviceBoot?: string) {
    if (draft.source && (draft.name !== next.name || draft.source !== next.source)) setConfirm({ kind: 'replace', draft: next, deviceBoot });
    else replace(next, deviceBoot);
  }
  async function openLocal(file: File | undefined) {
    if (!file) return;
    await perform(async () => {
      if (!file.name.toLowerCase().endsWith('.lua')) throw new Error('请选择 .lua 文件');
      if (file.size > 1024 * 1024) throw new Error('文件过大，最多打开 1 MB 的 Lua 文件');
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      requestReplace({ name: file.name, source });
    });
  }
  async function readFile(name: string) {
    await perform(async () => {
      const file = await device.get(name);
      requestReplace(file, device.getSnapshot().info?.boot_id);
    });
  }
  async function prepareSend() {
    await perform(async () => {
      const next = { ...draft };
      if (!/^[A-Za-z0-9_-]{1,36}\.lua$/.test(next.name)) throw new Error('文件名需为 1–36 位字母、数字、_、-，后缀为 .lua');
      const max = snapshot.info?.source_limit_bytes ?? 16384;
      if (!byteCount(next.source) || byteCount(next.source) > max || next.source.includes('\0')) throw new Error(`脚本需为 1–${max} 字节，不能包含 NUL`);
      const files = await device.list();
      const existing = files.find(file => file.name === next.name);
      if (existing?.protected) throw new Error('这是设备保护文件，不能覆盖');
      const previous = existing ? await device.describe(next.name) : null;
      setRunAfterSend(false);
      setConfirm({ kind: 'upload', draft: next, previousSha: previous?.sha256 ?? '', exists: !!existing });
    });
  }
  async function confirmAction() {
    const pending = confirm;
    if (!pending) return;
    if (pending.kind === 'replace') { replace(pending.draft, pending.deviceBoot); return; }
    const ok = await perform(async () => {
      if (pending.kind === 'delete') {
        await device.remove(pending.name, pending.sha);
        setConfirm(null);
        if (selected === pending.name) setSelected('');
        if (lastUpload?.name === pending.name) setLastUpload(null);
        await refreshFilesAfterMutation();
      } else {
        await device.upload(pending.draft.name, pending.draft.source, pending.previousSha);
        setLastUpload({ ...pending.draft, boot: device.getSnapshot().info?.boot_id ?? '' });
        // The file transaction is complete. A separate start failure must never
        // leave a stale confirmation that can replay the upload.
        setConfirm(null);
        addLog('link', 'info', `${pending.draft.name} 已写入设备，SHA-256 校验通过`);
        await refreshFilesAfterMutation();
        if (runAfterSend) {
          try { await device.run(pending.draft.name); }
          catch (error) { throw new Error(`文件已写入设备，但启动失败：${error instanceof Error ? error.message : String(error)}`); }
        }
      }
    }, pending.kind === 'delete' ? '已删除设备文件，本地草稿保留。' : runAfterSend ? '已写入设备并启动运行。' : '已写入设备，校验通过。');
    // Unknown outcomes must be inspected, not retried by clicking the old dialog.
    if (ok || device.getSnapshot().unknown.length) setConfirm(null);
  }
  async function prepareDelete(file: DeviceFile) {
    await perform(async () => {
      if (file.protected) throw new Error('这是设备保护文件，不能删除');
      const current = await device.describe(file.name);
      setConfirm({ kind: 'delete', name: file.name, sha: current.sha256 });
    });
  }
  const synced = lastUpload?.name === draft.name && lastUpload?.source === draft.source && lastUpload?.boot === snapshot.info?.boot_id;
  const storage = snapshot.storage;
  const capacity = storage?.capacity_valid && storage.total_bytes ? Math.min(100, Math.max(0, (storage.used_bytes ?? 0) / storage.total_bytes * 100)) : null;
  const job = snapshot.jobs.find(item => item.state === 'running');
  const knownError = sourceError?.source === draft.source ? sourceError : null;
  if (!loaded) return <div className="startup">RYZOBEE LINK</div>;
  return <main className="workbench">
    <header className="global-bar">
      <a className="brand" href="https://wiki.ryzobee.com/zh/home" target="_blank" rel="noreferrer"><img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" /><span>RYZOBEE LINK</span></a>
      <div className="global-actions"><span className="serial-support">Web Serial：{serialSupported ? '支持' : '不支持'}</span><span className={`connection ${ready ? 'success' : ''}`} role="status"><span className="status-dot" />{connectionLabels[snapshot.connection]}</span>
        <button disabled={busy} onClick={() => fileInput.current?.click()}>打开本地</button>
        <button onClick={() => { downloadLua(draft.name || 'untitled.lua', draft.source); addLog('link', 'info', '已导出本地草稿'); }}>保存草稿</button>
        <button className="primary" disabled={!ready || busy} onClick={() => void prepareSend()}>发送到设备</button>
        <button className="connect-button" disabled={busy || !serialSupported} onClick={() => void perform(() => snapshot.connection === 'disconnected' ? device.connectFromGesture() : device.disconnect())}>{snapshot.connection === 'disconnected' ? '连接设备' : '断开连接'}</button>
      </div>
      <input ref={fileInput} className="visually-hidden" type="file" accept=".lua,text/plain" aria-label="打开本地 Lua 文件" onChange={event => { void openLocal(event.target.files?.[0]); event.target.value = ''; }} />
    </header>
    {notice && <div className={`notice ${notice.error ? 'error' : 'success'}`} role={notice.error ? 'alert' : 'status'}><Icon name={notice.error ? 'warning' : 'check'} /><span>{notice.text}</span><button className="icon-button" aria-label="关闭消息" onClick={() => setNotice(null)}><Icon name="close" /></button></div>}
    {snapshot.unknown.length > 0 && <div className="notice warning" role="alert"><Icon name="warning" /><span>操作结果未知：{snapshot.unknown.join('、')}。请重新读取设备文件确认，未自动重试。</span></div>}
    <div className="workspace-grid">
      <aside className="left-column">
        <SimulatorPanel source={draft.source} onLog={simulatorLog} onError={setSourceError} />
        <section className="panel files-panel" aria-label="设备文件">
          <div className="panel-heading"><h2><Icon name="folder-opened" />设备文件</h2><span className="muted">/ {ready ? snapshot.files.length : '—'} 项</span></div>
          <div className="file-actions"><button disabled={!ready || !selected || busy} onClick={() => void readFile(selected)}>读取选中</button><button disabled={!ready || busy} onClick={() => fileInput.current?.click()}>打开本地</button><button disabled={!ready || busy} onClick={() => void perform(async () => { await device.list(); await device.storage(); })}>刷新</button></div>
          <div className="file-list">
            {!ready ? <div className="empty-state"><Icon name="plug" /><span>{serialSupported ? '连接设备后查看文件' : '请使用支持 Web Serial 的浏览器'}</span></div> : snapshot.files.length === 0 ? <div className="empty-state">设备暂无 Lua 文件</div> : snapshot.files.map(file => <div className={`file-row ${selected === file.name ? 'selected' : ''}`} key={file.name}>
              <button className="file-select" onClick={() => setSelected(file.name)} onDoubleClick={() => void readFile(file.name)} title={file.name}><Icon name={file.protected ? 'lock' : 'file-code'} /><span>{file.name}</span><small>{sizeLabel(file.bytes)}</small></button>
              <button className="icon-button" aria-label={`${file.name} 文件操作`} aria-expanded={menu === file.name} disabled={busy} onClick={() => { setSelected(file.name); setMenu(menu === file.name ? '' : file.name); }}><Icon name="ellipsis" /></button>
              {menu === file.name && <div className="file-menu" role="group" aria-label={`${file.name} 操作`}><button onClick={() => void readFile(file.name)}>读取到编辑器</button><button onClick={() => void perform(async () => { const data = await device.get(file.name); downloadLua(data.name, data.source); })}>下载到电脑</button><button onClick={() => void perform(() => device.run(file.name), '设备已开始运行。')}>在设备运行</button><button className="danger-text" disabled={file.protected} onClick={() => void prepareDelete(file)}>删除设备文件</button></div>}
            </div>)}
          </div>
          {job && <div className="device-job"><span title={job.name}>运行中 · {job.name}</span><button disabled={busy} onClick={() => void perform(() => device.stop(job.job_id), '已请求停止设备脚本。')}>停止</button></div>}
          <div className="storage"><div className="storage-info"><span>设备 / · Web Serial</span><span>{ready ? '115200' : '—'}</span></div><div className="storage-track"><span style={{ width: `${capacity ?? 0}%` }} /></div><div className="storage-info"><span>STORAGE</span><span>{capacity === null ? '—' : `${capacity.toFixed(0)}% · ${sizeLabel(storage!.used_bytes ?? 0)}`}</span></div></div>
        </section>
      </aside>
      <div className="right-column">
        <section className="panel editor-panel" aria-label="Lua 编辑器">
          <div className="editor-heading"><label className="file-tab"><Icon name="file-code" /><input aria-label="Lua 文件名" value={draft.name} maxLength={80} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /><span className={`draft-dot ${synced ? 'synced' : ''}`} /></label><span className={`editor-status ${knownError ? 'error' : ''}`} role="status">{knownError ? `第 ${knownError.line} 行 · 运行错误` : synced ? '已写入设备 · 校验通过' : `${saved && savedDraft?.source === draft.source ? '草稿已保存' : '保存中'} · 未写入设备`}</span></div>
          <LuaEditor key={editorRevision} source={draft.source} onChange={source => setDraft(current => ({ ...current, source }))} error={sourceError} />
        </section>
        <LogPanel logs={logs} onClear={() => { setLocalLogs([]); setClearedSerialId(snapshot.logs.at(-1)?.id ?? 0); }} />
      </div>
    </div>
    {confirm && <Modal busy={busy} title={confirm.kind === 'delete' ? '删除设备中的文件？' : confirm.kind === 'replace' ? '替换当前草稿？' : confirm.exists ? '覆盖设备中的脚本？' : '发送脚本到设备'} onClose={() => setConfirm(null)}>
      <div className="modal-file"><Icon name="file-code" />{confirm.kind === 'delete' ? confirm.name : confirm.draft.name}</div>
      {confirm.kind === 'delete' ? <p>仅删除设备文件，本地草稿保留。</p> : confirm.kind === 'replace' ? <p>当前编辑内容会被替换；需要保留时，请先保存草稿到电脑。</p> : <><p>{sizeLabel(byteCount(confirm.draft.source))} · RootMaker</p><label className="checkbox"><input type="checkbox" checked={runAfterSend} onChange={event => setRunAfterSend(event.target.checked)} />发送后自动运行</label></>}
      <div className="modal-actions"><button disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className={confirm.kind === 'delete' ? 'danger' : 'primary'} disabled={busy} onClick={() => void confirmAction()}>{busy ? '处理中…' : confirm.kind === 'delete' ? '删除设备文件' : confirm.kind === 'replace' ? '替换草稿' : '确认写入'}</button></div>
    </Modal>}
  </main>;
}
