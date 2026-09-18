import { DeviceClient, sourceHash, validFilename } from '../device';
import { WorkspaceStore } from '../workspace/store';
import { SimulatorSession } from '../simulator/session';
import { CommandError, type CommandBackend, type OperationResult } from './owner';
import { CommandLogs } from './logs';

const catalog = {
  help: { args: {}, description: 'List supported commands. No eval or arbitrary Console.' },
  'link.status': { args: {}, description: 'Page, device and simulator status.' },
  'workspace.list': { args: {}, description: 'Open documents, IDs and active selection (no source).' },
  'workspace.read': { args: { documentId: 'string?' }, description: 'Read source and SHA-256; defaults to active document.' },
  'workspace.open': { args: { name: 'string', source: 'string' }, description: 'Open and persist a new tab. Never replace a different existing tab.' },
  'workspace.update': { args: { documentId: 'string', expectedSha256: 'string', source: 'string', name: 'string?' }, description: 'Replace an existing document only if its source hash still matches.' },
  'workspace.select': { args: { documentId: 'string' }, description: 'Select an existing tab.' },
  'workspace.close': { args: { documentId: 'string', expectedSha256: 'string' }, description: 'Close a known tab, guarded by its source hash.' },
  'simulator.run': { args: { documentId: 'string?', expectedSha256: 'string?' }, description: 'Run a captured document version; accepted is not runtime success. Replaces previous simulation.' },
  'simulator.status': { args: {}, description: 'Query runId, state, source hash, frame revision and fault.' },
  'simulator.stop': { args: { runId: 'string' }, description: 'Stop the identified simulation.' },
  'simulator.pointer': { args: { runId: 'string', x: 'number', y: 'number', pressed: 'boolean' }, description: 'Touch 0..239 coordinates; send press then release. (-1,-1,false) cancels.' },
  'simulator.capture': { args: { runId: 'string' }, description: 'Latest simulator frame as PNG data URL. Not a physical screen capture.' },
  'device.connect': { args: {}, description: 'Ask the user to click Connect on the main page; never invokes the chooser in background.' },
  'device.info': { args: {}, description: 'Read live firmware/device information.' },
  'device.files': { args: {}, description: 'Read device catalog and storage.' },
  'device.read': { args: { name: 'string' }, description: 'Read a device file and hash; does not overwrite the workspace.' },
  'device.upload': { args: { documentId: 'string', expectedSha256: 'string', previousSha256: 'string' }, description: 'Save the captured document to device, no simulation gate and no auto-run. previousSha256: empty for new file; read existing hash before overwrite.' },
  'device.run': { args: { name: 'string' }, description: 'Run the saved device file; returns accepted job, not completion. Independent of simulation.' },
  'device.jobs': { args: {}, description: 'Read current/recent device jobs via authoritative info.' },
  'device.stop': { args: { jobId: 'string' }, description: 'Request cooperative stop for a device job.' },
  'logs.read': { args: { localAfter: 'number?', serialAfter: 'number?', limit: 'number?', runId: 'string?', jobId: 'string?' }, description: 'Incremental bounded logs. Use returned cursors; truncated signals loss. Device logs use jobId, simulator logs use runId.' },
} as const;
type Command = keyof typeof catalog;
function validate(command: string, args: Record<string, unknown>): asserts command is Command {
  if (!Object.hasOwn(catalog, command)) throw new CommandError('UNKNOWN_COMMAND', '未知命令，请调用 help');
  const schema: Record<string, string> = catalog[command as Command].args;
  for (const key of Object.keys(args)) if (!Object.hasOwn(schema, key)) throw new CommandError('INVALID_ARGUMENT', `不支持参数 ${key}`);
  for (const [key, spec] of Object.entries(schema)) {
    const value = args[key], type = spec.replace('?', '');
    if (value === undefined && spec.endsWith('?')) continue;
    if (typeof value !== type || (type === 'number' && !Number.isFinite(value))) throw new CommandError('INVALID_ARGUMENT', `${key} 需要 ${spec}`);
    if (typeof value === 'string' && key !== 'source' && value.length > 256) throw new CommandError('INVALID_ARGUMENT', `${key} 过长`);
  }
}
function sourceInput(name: string, source: string) {
  if (!validFilename(name)) throw new CommandError('INVALID_FILENAME', '文件名需为 1–36 位字母、数字、_、-，后缀为 .lua');
  if (new TextEncoder().encode(source).length > 1024 * 1024 || source.includes('\0')) throw new CommandError('INVALID_SOURCE', '源码最多 1 MiB，不能包含 NUL');
}

/** Actual app services shared by mouse/keyboard and command callers. */
export class CommandKernel implements CommandBackend {
  private busy = false;
  private listeners = new Set<() => void>();
  constructor(readonly device: DeviceClient, readonly workspace: WorkspaceStore, readonly simulator: SimulatorSession,
    readonly logs: CommandLogs, private effects: { connectionNeeded(): void; externalEdit(id: string): void }) {}
  getSnapshot = () => this.busy;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private setBusy(value: boolean) { this.busy = value; for (const listener of this.listeners) listener(); }
  // Action is called synchronously to preserve Web Serial's trusted click activation.
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new CommandError('BUSY', '另一项操作正在进行，请查询状态后再操作');
    this.setBusy(true);
    try { return await action(); } finally { this.setBusy(false); }
  }
  identity = () => ({ connection: this.device.getSnapshot().connection, boot: this.device.getSnapshot().info?.boot_id ?? null, epoch: this.device.getConnectionEpoch() });
  private async document(id: string | undefined, expected: string | undefined, guard: () => void) {
    const document = this.workspace.read(id);
    if (!document) throw new CommandError('NO_DOCUMENT', '请先打开一个 Lua 文件');
    const sha256 = await sourceHash(document.source);
    guard();
    if (this.workspace.read(document.id) !== document || (expected !== undefined && sha256 !== expected)) throw new CommandError('SOURCE_CHANGED', '草稿已改变，请重新读取，不要覆盖用户修改');
    return { ...document, sha256 };
  }
  private runIdentity(runId: unknown) {
    if (runId !== this.simulator.getSnapshot().runId) throw new CommandError('RUN_CHANGED', '模拟器运行已改变，请重新查询状态');
  }
  async execute(command: string, args: Record<string, unknown>, guard: () => void): Promise<OperationResult> {
    validate(command, args);
    guard();
    const execute = () => this.dispatch(command, args, guard);
    const readOnly = ['help', 'link.status', 'workspace.list', 'workspace.read', 'simulator.status', 'simulator.capture', 'logs.read'];
    return readOnly.includes(command) ? execute() : this.exclusive(execute);
  }
  private async dispatch(command: Command, a: Record<string, unknown>, guard: () => void): Promise<OperationResult> {
    const string = (key: string) => a[key] as string;
    if (command.startsWith('workspace.') || command === 'simulator.run' || command === 'device.upload') {
      await this.workspace.load(); guard();
    }
    if (command.startsWith('device.') && command !== 'device.connect' && this.device.getSnapshot().connection !== 'ready') {
      this.effects.connectionNeeded();
      throw new CommandError('NEEDS_CONNECTION', '请在用户页面点击连接并选择 Ryzobee 串口，然后使用新的请求编号继续');
    }
    // A board can reboot without closing the serial port. Probe its boot ID
    // immediately before a mutation, then re-check the user grant.
    if (['device.upload', 'device.run', 'device.stop'].includes(command)) { await this.device.info(); guard(); }
    switch (command) {
      case 'help': return { data: { protocolVersion: 1, commands: catalog } };
      case 'link.status': return { data: { ...this.identity(), busy: this.busy, workspaceLoaded: this.workspace.getSnapshot().loaded,
        activeId: this.workspace.getSnapshot().activeId, simulator: this.simulator.getSnapshot().state, unknown: this.device.getSnapshot().unknown } };
      case 'workspace.list': return { data: { ...this.workspace.getSnapshot(), documents: this.workspace.getSnapshot().documents.map(({ id, name, source }) => ({ id, name, bytes: new TextEncoder().encode(source).length })) } };
      case 'workspace.read': return { data: await this.document(a.documentId as string | undefined, undefined, guard) };
      case 'workspace.open': {
        sourceInput(string('name'), string('source'));
        const document = this.workspace.openDocument({ name: string('name'), source: string('source') });
        await this.workspace.flush();
        return { data: { ...document, sha256: await sourceHash(document.source), persisted: true } };
      }
      case 'workspace.update': case 'workspace.close': {
        const current = await this.document(string('documentId'), string('expectedSha256'), guard);
        if (command === 'workspace.close') { this.workspace.closeDocument(current.id); await this.workspace.flush(); return { data: { closed: current.id } }; }
        sourceInput(a.name === undefined ? current.name : string('name'), string('source'));
        const document = this.workspace.updateDocument(current.id, { name: a.name as string | undefined, source: string('source') });
        this.effects.externalEdit(current.id);
        await this.workspace.flush();
        return { data: { ...document, sha256: await sourceHash(document.source), persisted: true } };
      }
      case 'workspace.select': this.workspace.read(string('documentId')); this.workspace.selectDocument(string('documentId')); await this.workspace.flush(); return { data: { activeId: string('documentId') } };
      case 'simulator.run': {
        const document = await this.document(a.documentId as string | undefined, a.expectedSha256 as string | undefined, guard);
        return { accepted: true, data: { ...await this.simulator.run(document.source, document.name, guard), sha256: document.sha256, documentId: document.id } };
      }
      case 'simulator.status': {
        const { source, ...state } = this.simulator.getSnapshot();
        return { data: { ...state, sha256: state.runId ? await sourceHash(source) : null } };
      }
      case 'simulator.stop': this.runIdentity(a.runId); await this.simulator.stop(); return { data: this.simulator.getSnapshot().state };
      case 'simulator.capture': this.runIdentity(a.runId); return { data: this.simulator.capture() };
      case 'simulator.pointer': {
        this.runIdentity(a.runId);
        if (this.simulator.getSnapshot().state !== 'running') throw new CommandError('NOT_RUNNING', '模拟器尚未运行');
        const x = a.x as number, y = a.y as number, pressed = a.pressed as boolean;
        if (!(x === -1 && y === -1 && !pressed) && (![x, y].every(Number.isInteger) || x < 0 || x > 239 || y < 0 || y > 239)) throw new CommandError('INVALID_COORDINATES', '触摸坐标必须在 0..239 范围内');
        this.simulator.pointer({ x, y, pressed }); return { data: { delivered: true, runId: a.runId } };
      }
      case 'device.connect': this.effects.connectionNeeded(); return { accepted: true, data: { needsUserGesture: true } };
      case 'device.info': { const info = await this.device.info(); guard(); return { data: info }; }
      case 'device.files': { const files = await this.device.list(); guard(); const storage = await this.device.storage(); guard(); return { data: { files, storage } }; }
      case 'device.read': { const file = await this.device.get(string('name')); guard(); return { data: file }; }
      case 'device.upload': {
        const document = await this.document(string('documentId'), string('expectedSha256'), guard);
        const sha256 = await this.device.upload(document.name, document.source, string('previousSha256'), guard);
        this.logs.add('link', 'info', `AI 已发送 ${document.name} · SHA-256 ${sha256}`);
        // Saving and running are deliberately separate commands. Refresh is read-only.
        void Promise.all([this.device.list(), this.device.storage()]).catch(error => this.logs.add('link', 'warn', `已写入，刷新失败：${String(error)}`));
        return { data: { state: 'committed', name: document.name, sha256 } };
      }
      case 'device.run': return { accepted: true, data: await this.device.run(string('name'), guard) };
      case 'device.stop': return { accepted: true, data: await this.device.stop(string('jobId'), guard) };
      case 'device.jobs': { await this.device.info(); guard(); return { data: { jobs: this.device.getSnapshot().jobs } }; }
      case 'logs.read': {
        const localAfter = (a.localAfter ?? 0) as number, serialAfter = (a.serialAfter ?? 0) as number, limit = (a.limit ?? 50) as number;
        if (![localAfter, serialAfter, limit].every(Number.isSafeInteger) || localAfter < 0 || serialAfter < 0 || limit < 1 || limit > 100) throw new CommandError('INVALID_ARGUMENT', '日志游标为非负整数，limit 为 1..100');
        const local = this.logs.getSnapshot(), serial = this.device.getSnapshot().logs;
        const localRows = local.filter(row => row.sequence > localAfter).slice(0, limit);
        const serialRows = serial.filter(row => row.id > serialAfter).slice(0, limit);
        return { data: { local: localRows.filter(row => !a.runId || row.runId === a.runId), serial: serialRows.filter(row => !a.jobId || row.jobId === a.jobId),
          cursor: { localAfter: localRows.at(-1)?.sequence ?? localAfter, serialAfter: serialRows.at(-1)?.id ?? serialAfter },
          truncated: !!((local[0] && local[0].sequence > localAfter + 1) || (serial[0] && serial[0].id > serialAfter + 1)),
          hasMore: (local.at(-1)?.sequence ?? 0) > (localRows.at(-1)?.sequence ?? localAfter) || (serial.at(-1)?.id ?? 0) > (serialRows.at(-1)?.id ?? serialAfter) } };
      }
    }
  }
}
