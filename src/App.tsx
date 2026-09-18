import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DeviceClient } from './device';
import type { DeviceFile } from './device/types';
import LuaEditor, { type SourceError } from './components/LuaEditor';
import SimulatorPanel from './components/SimulatorPanel';
import LogPanel from './components/LogPanel';
import Modal from './components/Modal';
import Icon from './components/Icon';
import ShortcutHelp from './components/ShortcutHelp';
import { shortcutAria, shortcutLabel, useKeyboardShortcuts } from './workspace/shortcuts';
import { downloadLua } from './workspace/drafts';
import { useWorkspace } from './workspace/useWorkspace';
import { logLevel, type LogEntry } from './workspace/logs';
import { WorkspaceStore } from './workspace/store';
import { SimulatorSession } from './simulator/session';
import { CommandKernel } from './commands/kernel';
import { CommandOwner } from './commands/owner';
import { CommandLogs } from './commands/logs';
import { BrowserMcpServer } from './commands/mcp';

type DraftContent = { name: string; source: string };
type Confirm = { kind: 'upload'; draft: DraftContent; previousSha: string; exists: boolean }
  | { kind: 'delete'; name: string; sha: string };
const byteCount = (source: string) => new TextEncoder().encode(source).length;
const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
const connectionLabels = { disconnected: '未连接', connecting: '连接中', 'serial-open': '识别中', ready: '已连接' };

export default function App() {
  const [device] = useState(() => new DeviceClient());
  const [workspace] = useState(() => new WorkspaceStore());
  const [simulator] = useState(() => new SimulatorSession());
  const [commandLogs] = useState(() => new CommandLogs());
  const [connectionRequested, setConnectionRequested] = useState(false);
  const [editorRevisions, setEditorRevisions] = useState<Record<string, number>>({});
  const [kernel] = useState(() => new CommandKernel(device, workspace, simulator, commandLogs, {
    connectionNeeded: () => setConnectionRequested(true),
    externalEdit: id => setEditorRevisions(current => ({ ...current, [id]: (current[id] ?? 0) + 1 })),
  }));
  const [owner] = useState(() => new CommandOwner(kernel));
  const [mcp] = useState(() => new BrowserMcpServer(owner));
  const control = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const busy = useSyncExternalStore(kernel.subscribe, kernel.getSnapshot);
  const snapshot = useSyncExternalStore(device.subscribe, device.getSnapshot);
  const { documents, draft, loaded, saved, storageError, updateDraft: setDraft, openDocument, selectDocument, createDocument, closeDocument } = useWorkspace(workspace);
  const [selected, setSelected] = useState('');
  const [menu, setMenu] = useState('');
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuScrollPosition = useRef({ x: 0, y: 0, list: 0 });
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [runAfterSend, setRunAfterSend] = useState(true);
  const [sourceError, setSourceError] = useState<SourceError | null>(null);
  const [revealLinkLogs, setRevealLinkLogs] = useState(0);
  const [uploads, setUploads] = useState<Record<string, DraftContent & { boot: string }>>({});
  const lastUpload = uploads[draft.name];
  function setLastUpload(value: DraftContent & { boot: string }) {
    setUploads(current => ({ ...current, [value.name]: value }));
  }
  const allLocalLogs = useSyncExternalStore(commandLogs.subscribe, commandLogs.getSnapshot);
  const [clearedLocalId, setClearedLocalId] = useState(0);
  const localLogs = useMemo(() => allLocalLogs.filter(row => row.sequence > clearedLocalId), [allLocalLogs, clearedLocalId]);
  const [clearedSerialId, setClearedSerialId] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  const simulatorButton = useRef<HTMLButtonElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  useKeyboardShortcuts({ open: openButton, save: saveButton, send: sendButton, simulate: simulatorButton, help: helpButton });
  const tabNames = JSON.stringify(documents.map(item => item.name));
  useEffect(() => {
    if (!loaded) return;
    const tab = document.getElementById('file-tab-' + draft.id)?.parentElement;
    const strip = tab?.parentElement;
    if (!tab || !strip) return;
    const reveal = () => {
      const tabs = [...strip.querySelectorAll<HTMLElement>('.editor-tab')];
      const available = strip.clientWidth;
      const natural = tabs.map(element => Math.max(120, Math.ceil(element.querySelector('.tab-measure')!.getBoundingClientRect().width) + 78 + (element.querySelector('small')?.getBoundingClientRect().width ?? 0)));
      const fits = natural.reduce((sum, width) => sum + width, 0) + (tabs.length - 1) * 4 <= available;
      // The active file keeps its full name; only inactive tabs share the remaining space.
      const activeIndex = tabs.indexOf(tab);
      const uniform = Math.max(120, Math.floor((available - natural[activeIndex] - (tabs.length - 1) * 4) / Math.max(1, tabs.length - 1)));
      tabs.forEach((element, index) => { element.style.width = `${fits || index === activeIndex ? natural[index] : uniform}px`; });
      const item = tab.getBoundingClientRect(), bounds = strip.getBoundingClientRect();
      if (item.width > bounds.width || item.left < bounds.left) strip.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right) strip.scrollLeft += item.right - bounds.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(strip);
    const scrollTabs = (event: WheelEvent) => {
      if (event.ctrlKey || strip.scrollWidth <= strip.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const before = strip.scrollLeft;
      strip.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1);
      if (strip.scrollLeft !== before) event.preventDefault();
    };
    strip.addEventListener('wheel', scrollTabs, { passive: false });
    document.fonts.addEventListener('loadingdone', reveal);
    return () => { observer.disconnect(); strip.removeEventListener('wheel', scrollTabs); document.fonts.removeEventListener('loadingdone', reveal); };
  }, [draft.id, loaded, tabNames]);
  const ready = snapshot.connection === 'ready';
  const serialSupported = 'serial' in navigator && window.isSecureContext;
  const serialWarningLogged = useRef(false);
  const addLog = useCallback((source: LogEntry['source'], level: string, message: string) => {
    commandLogs.add(source, level, message);
  }, [commandLogs]);
  useEffect(() => {
    if (serialSupported || serialWarningLogged.current) return;
    serialWarningLogged.current = true;
    addLog('link', 'warn', '当前环境不支持 Web Serial，无法连接设备。请使用支持串口的浏览器，并通过 HTTPS 或 localhost 打开。');
  }, [serialSupported, addLog]);
  const saveLocalDraft = useCallback(() => {
    if (!draft.id) return;
    downloadLua(draft.name || 'untitled.lua', draft.source);
    addLog('link', 'info', '已导出本地草稿');
  }, [draft.id, draft.name, draft.source, addLog]);
  const simulatorLog = useCallback(() => {}, []);
  useEffect(() => simulator.onLog(log => commandLogs.add('simulator', log.level, log.message, log.runId)), [simulator, commandLogs]);
  const simulatorError = useCallback((error: SourceError | null) => {
    setSourceError(error?.line ? error : null);
    if (error) addLog('link', error.limitation ? 'warn' : 'error', error.diagnostic ?? error.message);
  }, [addLog]);
  const logs = useMemo(() => [...localLogs, ...snapshot.logs.filter(row => row.id > clearedSerialId).map(row => ({
    id: `serial-${row.id}`, time: row.time, source: 'serial' as const, level: logLevel(row.kind, row.text), message: row.text, spans: row.spans,
  }))].sort((a, b) => a.time - b.time).slice(-1200), [localLogs, snapshot.logs, clearedSerialId]);

  useEffect(() => () => { void device.disconnect(); }, [device]);
  useEffect(() => {
    const detach = mcp.attach();
    const unsubscribe = device.subscribe(owner.checkIdentity);
    return () => { unsubscribe(); detach(); simulator.dispose(); };
  }, [owner, device, simulator, mcp]);
  useEffect(() => { if (control.reason) addLog('link', 'info', control.reason); }, [control.reason, addLog]);
  useEffect(() => { if (snapshot.connection === 'ready' || !control.grant) setConnectionRequested(false); }, [snapshot.connection, control.grant]);
  useEffect(() => { if (storageError) setNotice({ text: storageError, error: true }); }, [storageError]);
  useEffect(() => {
    const closeMenu = () => setMenu('');
    const closeMovedMenu = () => {
      const openedAt = menuScrollPosition.current;
      if (window.scrollX !== openedAt.x || window.scrollY !== openedAt.y) closeMenu();
    };
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMovedMenu);
    return () => { window.removeEventListener('resize', closeMenu); window.removeEventListener('scroll', closeMovedMenu); };
  }, []);
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
    setNotice(null); setMenu('');
    try {
      await kernel.exclusive(action);
      if (success) { setNotice({ text: success, error: false }); addLog('link', 'info', success); }
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setNotice({ text, error: true }); addLog('link', 'error', text); return false;
    }
  };
  function openFile(next: DraftContent, deviceBoot?: string) {
    openDocument(next);
    if (deviceBoot) setLastUpload({ ...next, boot: deviceBoot });
  }
  async function openLocal(file: File | undefined) {
    if (!file) return;
    await perform(async () => {
      if (!file.name.toLowerCase().endsWith('.lua')) throw new Error('请选择 .lua 文件');
      if (file.size > 1024 * 1024) throw new Error('文件过大，最多打开 1 MB 的 Lua 文件');
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      openFile({ name: file.name, source });
    });
  }
  async function readFile(name: string) {
    if (!ready || busy) return;
    await perform(async () => {
      const file = await device.get(name);
      openFile(file, device.getSnapshot().info?.boot_id);
    });
  }
  async function prepareSend() {
    if (!draft.id) return;
    await perform(async () => {
      const next = { ...draft };
      if (!/^[A-Za-z0-9_-]{1,36}\.lua$/.test(next.name)) throw new Error('文件名需为 1–36 位字母、数字、_、-，后缀为 .lua');
      const max = snapshot.info?.source_limit_bytes ?? 16384;
      if (!byteCount(next.source) || byteCount(next.source) > max || next.source.includes('\0')) throw new Error(`脚本需为 1–${max} 字节，不能包含 NUL`);
      const files = await device.list();
      const existing = files.find(file => file.name === next.name);
      if (existing?.protected) throw new Error('这是设备保护文件，不能覆盖');
      const previous = existing ? await device.describe(next.name) : null;
      setRunAfterSend(true);
      setConfirm({ kind: 'upload', draft: next, previousSha: previous?.sha256 ?? '', exists: !!existing });
    });
  }
  async function confirmAction() {
    const pending = confirm;
    if (!pending) return;
    const ok = await perform(async () => {
      if (pending.kind === 'delete') {
        await device.remove(pending.name, pending.sha);
        setConfirm(null);
        if (selected === pending.name) setSelected('');
        setUploads(current => { const next = { ...current }; delete next[pending.name]; return next; });
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
  const headerNotice = snapshot.unknown.length > 0
    ? { text: `操作结果未知：${snapshot.unknown.join('、')}。请重新读取设备文件确认，未自动重试。`, tone: 'warning', dismissible: false }
    : notice ? { text: notice.text, tone: notice.error ? 'error' : 'success', dismissible: true } : null;
  if (!loaded) return <div className="startup">RYZOBEE LINK</div>;
  return <main className="workbench">
    <header className="global-bar">
      <a className="brand" href="https://wiki.ryzobee.com/zh/home" target="_blank" rel="noreferrer"><img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" /><span>RYZOBEE LINK</span></a>
      <div className="header-status">
        {control.grant && <button className="ai-control" title={`当前控制：${control.grant.label}`} onClick={() => owner.revoke()}>结束 AI 控制</button>}
        {headerNotice ? <div className={`header-notice ${headerNotice.tone}`} role={headerNotice.tone === 'success' ? 'status' : 'alert'} aria-atomic="true">
          <Icon name={headerNotice.tone === 'success' ? 'check' : 'warning'} />
          <span className="notice-text" title={headerNotice.text}>{headerNotice.text}</span>
          {headerNotice.dismissible && <button className="icon-button" aria-label="关闭消息" onClick={() => setNotice(null)}><Icon name="close" /></button>}
        </div> : null}
      </div>
      <div className="global-actions"><span className={`connection ${ready ? 'success' : ''}`} role="status"><span className="status-dot" />{connectionLabels[snapshot.connection]}</span>
        <button ref={openButton} disabled={busy} onClick={() => fileInput.current?.click()} title={`打开本地 Lua 文件（${shortcutLabel('open')}）`} aria-keyshortcuts={shortcutAria('open')}>打开</button>
        <button ref={saveButton} disabled={!draft.id} onClick={saveLocalDraft} title={`保存当前 Lua 到电脑（${shortcutLabel('save')}）`} aria-keyshortcuts={shortcutAria('save')}>保存</button>
        <button ref={sendButton} className="primary" disabled={!draft.id || !ready || busy} onClick={() => void prepareSend()} title={`发送当前 Lua 到设备（${shortcutLabel('send')}）`} aria-keyshortcuts={shortcutAria('send')}>发送</button>
        <button className="connect-button" disabled={busy || !serialSupported} title={snapshot.connection === 'disconnected' ? '连接设备' : '断开设备连接'} onClick={() => void perform(() => snapshot.connection === 'disconnected' ? device.connectFromGesture() : device.disconnect())}>{snapshot.connection === 'disconnected' ? '连接' : '断开'}</button>
      </div>
      <input ref={fileInput} className="visually-hidden" type="file" multiple accept=".lua,text/plain" aria-label="打开本地 Lua 文件" onChange={event => { const files = Array.from(event.target.files ?? []); void (async () => { for (const file of files) await openLocal(file); })(); event.target.value = ''; }} />
    </header>
    <div className="workspace-grid">
      <aside className="left-column">
        <SimulatorPanel session={simulator} toggleRef={simulatorButton} hasDocument={!!draft.id} source={draft.source} sourceName={draft.name} onLog={simulatorLog} onError={simulatorError} onShowLogs={() => setRevealLinkLogs(value => value + 1)} />
        <section className="panel files-panel" aria-label="设备文件">
          <div className="panel-heading"><h2><Icon name="folder-opened" />设备文件</h2>{ready && <span className="muted">{snapshot.files.some(file => file.name === selected) ? 1 : 0} / {snapshot.files.length} 项</span>}</div>
          <div className="file-list" onScroll={event => { if (event.currentTarget.scrollTop !== menuScrollPosition.current.list) setMenu(''); }}>
            {!ready ? <div className="empty-state"><Icon name="plug" /><span>连接设备后查看文件</span></div> : snapshot.files.length === 0 ? <div className="empty-state">设备暂无 Lua 文件</div> : snapshot.files.map(file => <div className={`file-row ${selected === file.name ? 'selected' : ''}`} key={file.name}>
              <button className="file-select" disabled={busy} onClick={() => setSelected(file.name)} onDoubleClick={() => void readFile(file.name)} title={file.name}><Icon name={file.protected ? 'lock' : 'file-code'} /><span>{file.name}</span><small>{sizeLabel(file.bytes)}</small></button>
              <button className="icon-button" aria-label={`${file.name} 文件操作`} aria-expanded={menu === file.name} disabled={busy} onClick={event => {
                const anchor = event.currentTarget.getBoundingClientRect();
                // Ignore a delayed scroll event from bringing this button into view.
                menuScrollPosition.current = { x: window.scrollX, y: window.scrollY, list: event.currentTarget.closest('.file-list')?.scrollTop ?? 0 };
                setMenuPosition({ top: Math.max(12, Math.min(anchor.bottom + 4, window.innerHeight - 184)), left: Math.max(12, Math.min(anchor.right - 192, window.innerWidth - 204)) });
                setSelected(file.name); setMenu(menu === file.name ? '' : file.name);
              }}><Icon name="ellipsis" /></button>
              {menu === file.name && <div className="file-menu" style={menuPosition} role="group" aria-label={`${file.name} 操作`}><button onClick={() => void readFile(file.name)}>读取到编辑器</button><button onClick={() => void perform(async () => { const data = await device.get(file.name); downloadLua(data.name, data.source); })}>下载到电脑</button><button onClick={() => void perform(() => device.run(file.name), '设备已开始运行。')}>在设备运行</button><button className="danger-text" disabled={file.protected} onClick={() => void prepareDelete(file)}>删除设备文件</button></div>}
            </div>)}
          </div>
          {job && <div className="device-job"><span title={job.name}>运行中 · {job.name}</span><button disabled={busy} onClick={() => void perform(() => device.stop(job.job_id), '已请求停止设备脚本。')}>停止</button></div>}
          <div className="storage"><div className="storage-track"><span style={{ width: `${capacity ?? 0}%` }} /></div><div className="storage-info"><span>STORAGE</span><span>{capacity === null ? '—' : `${capacity.toFixed(0)}% · ${sizeLabel(storage!.used_bytes ?? 0)}`}</span></div></div>
        </section>
      </aside>
      <div className="right-column">
        <section className="panel editor-panel" aria-label="Lua 编辑器">
          <div className="editor-tabs-row">
            <div className="editor-tabs" role="tablist" aria-label="打开的 Lua 文件">
              {documents.map((item, index) => <div key={item.id} className={`editor-tab ${item.id === draft.id ? 'active' : ''}`} role="presentation"><span className="tab-measure" aria-hidden="true">{item.name || 'untitled.lua'}</span><button role="tab" aria-label={item.name || 'untitled.lua'} id={'file-tab-' + item.id} aria-controls="lua-document" aria-selected={item.id === draft.id} tabIndex={item.id === draft.id ? 0 : -1}
                title={item.name} onClick={() => selectDocument(item.id)} onKeyDown={event => {
                  const next = event.key === 'ArrowRight' ? (index + 1) % documents.length : event.key === 'ArrowLeft' ? (index + documents.length - 1) % documents.length : event.key === 'Home' ? 0 : event.key === 'End' ? documents.length - 1 : -1;
                  if (next < 0) return;
                  event.preventDefault(); selectDocument(documents[next].id);
                  document.getElementById('file-tab-' + documents[next].id)?.focus();
                }}><Icon name="file-code" />{item.id !== draft.id && <span className="tab-name">{item.name || 'untitled.lua'}</span>}</button>{item.id === draft.id && <input aria-label="Lua 文件名" value={draft.name} maxLength={80} title={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} />}{documents.slice(0, index).filter(other => other.name === item.name).length > 0 && <small>· {documents.slice(0, index).filter(other => other.name === item.name).length + 1}</small>}<button className="tab-close" aria-label={`关闭 ${item.name || 'untitled.lua'}`} title="关闭标签" onClick={() => closeDocument(item.id)}><Icon name="close" /></button></div>)}
            </div>
            <button className="icon-button" aria-label="新建 Lua 文件" onClick={createDocument}><Icon name="add" /></button>
            <button ref={helpButton} className="icon-button" aria-label="快捷键" disabled={busy} title={`快捷键（${shortcutLabel('help')}）`} aria-keyshortcuts={shortcutAria('help')} onClick={() => { setMenu(''); setShowShortcuts(true); }}><Icon name="keyboard" /></button>
            <span className={`editor-status ${knownError ? knownError.limitation ? 'warning' : 'error' : ''}`} role="status" data-save-state={saved ? 'saved' : 'saving'}>{!draft.id ? '' : knownError ? `第 ${knownError.line} 行 · ${knownError.limitation ? '模拟器限制' : '运行错误'}` : synced ? '已写入设备 · 校验通过' : ''}</span>
          </div>
          {draft.id ? <div className="editor-document" id="lua-document" role="tabpanel" aria-labelledby={'file-tab-' + draft.id}><LuaEditor key={`${draft.id}:${editorRevisions[draft.id] ?? 0}`} source={draft.source} onChange={source => setDraft(current => ({ ...current, source }))} error={sourceError} /></div> : <div className="editor-empty"><Icon name="files" /><button onClick={createDocument}>新建 Lua 文件</button><button onClick={() => fileInput.current?.click()}>打开本地文件</button></div>}
        </section>
        <LogPanel logs={logs} revealLink={revealLinkLogs} onClear={() => { setClearedLocalId(allLocalLogs.at(-1)?.sequence ?? 0); setClearedSerialId(snapshot.logs.at(-1)?.id ?? 0); }} />
      </div>
    </div>
    {showShortcuts && <ShortcutHelp onClose={() => setShowShortcuts(false)} />}
    {control.pending && !confirm && !showShortcuts && <Modal title="允许 AI 控制本次会话？" onClose={() => owner.revoke('已拒绝 AI 控制')}>
      <p>{control.pending.label}</p>
      <p>可读写当前草稿、操作模拟器，以及上传和运行设备脚本。关闭或重新加载本页面、设备断开或重启后需重新授权。</p>
      <div className="modal-actions"><button onClick={() => owner.revoke('已拒绝 AI 控制')}>拒绝</button><button className="primary" onClick={() => owner.approve()}>允许本次控制</button></div>
    </Modal>}
    {connectionRequested && control.grant && !confirm && !showShortcuts && <Modal title="AI 请求连接设备" busy={busy} onClose={() => setConnectionRequested(false)}>
      <p>选择 Ryzobee 串口后，AI 才能继续设备操作。</p>
      <div className="modal-actions"><button disabled={busy} onClick={() => setConnectionRequested(false)}>取消</button><button className="primary" disabled={busy || !serialSupported} onClick={() => void perform(async () => { await device.connectFromGesture(); setConnectionRequested(false); })}>连接设备</button></div>
    </Modal>}
    {confirm && <Modal busy={busy} title={confirm.kind === 'delete' ? '删除设备中的文件？' : confirm.exists ? '覆盖设备中的脚本？' : '发送脚本到设备'} onClose={() => setConfirm(null)}>
      <div className="modal-file"><Icon name="file-code" />{confirm.kind === 'delete' ? confirm.name : confirm.draft.name}</div>
      {confirm.kind === 'delete' ? <p>仅删除设备文件，本地草稿保留。</p> : <><p>{sizeLabel(byteCount(confirm.draft.source))} · RootMaker</p><label className="checkbox"><input type="checkbox" checked={runAfterSend} onChange={event => setRunAfterSend(event.target.checked)} />发送后自动运行</label></>}
      <div className="modal-actions"><button disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className={confirm.kind === 'delete' ? 'danger' : 'primary'} disabled={busy} onClick={() => void confirmAction()}>{busy ? '处理中…' : confirm.kind === 'delete' ? '删除设备文件' : '确认'}</button></div>
    </Modal>}
  </main>;
}
