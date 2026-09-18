import { AnsiDecoder } from './ansi';
import type { BoardInfo, DeviceFile, DeviceSnapshot, FileDescription, FileSource, Job, LogRow, SerialAPI, SerialPortLike, StorageStatus } from './types';

export * from './types';
export const STORE_SCHEMA = 'ryz-script-store/1';
const encoder = new TextEncoder();
const shaPattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
type Reply = Record<string, unknown> & { id: string; ok: boolean };
type Pending = {
  action: string;
  mutation: boolean;
  sent: boolean;
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class UnknownResultError extends Error {
  constructor(action: string) {
    super(`结果未知：${action}。请重新查询设备，不要直接重复发送。`);
    this.name = 'UnknownResultError';
  }
}

export function serialAPI(): SerialAPI | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { serial?: SerialAPI }).serial;
}
export function validFilename(name: string) { return /^[A-Za-z0-9_-]{1,36}\.lua$/.test(name); }
export async function sourceHash(source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(source));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function isJob(value: unknown): value is Job {
  return record(value) && typeof value.job_id === 'string' && identifierPattern.test(value.job_id) &&
    typeof value.name === 'string' && typeof value.state === 'string' && ['running', 'done', 'stopped', 'timeout', 'failed'].includes(value.state);
}
function file(value: unknown): DeviceFile {
  if (!record(value) || typeof value.name !== 'string' || !validFilename(value.name) || !count(value.bytes) || typeof value.protected !== 'boolean')
    throw new Error('设备返回了无效的文件信息');
  return { name: value.name, bytes: value.bytes, protected: value.protected };
}

/** Owns UART I/O. No simulator checks, eval, reset, auto-run or mutation retries. */
export class DeviceClient {
  private state: DeviceSnapshot = { connection: 'disconnected', info: null, files: [], storage: null, jobs: [], logs: [], unknown: [], error: null };
  private listeners = new Set<() => void>();
  private pending = new Map<string, Pending>();
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readTask: Promise<void> | null = null;
  private cleanup: Promise<void> = Promise.resolve();
  private writes: Promise<void> = Promise.resolve();
  private generation = 0;
  private requestId = 0;
  private readonly prefix = Math.random().toString(36).slice(2, 10);
  private logId = 0;
  private logBytes = 0;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private ansi = new Map<string, AnsiDecoder>();
  private output = new Map<string, { decoder: TextDecoder; sequence: number }>();

  constructor(private readonly timeoutMs = 6000) {}
  getSnapshot = () => this.state;
  getConnectionEpoch = () => this.generation;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private publish(patch: Partial<DeviceSnapshot>) {
    this.state = { ...this.state, ...patch };
    if (!this.notifyTimer) this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const listener of this.listeners) listener();
    }, 16);
  }

  message(text: string, kind: LogRow['kind'] = 'system', jobId?: string) {
    const key = jobId ?? kind;
    let ansi = this.ansi.get(key);
    if (!ansi) { ansi = new AnsiDecoder(); this.ansi.set(key, ansi); }
    const spans = ansi.decode(text.slice(0, 65536));
    const plain = spans.map(span => span.text).join('');
    if (!plain) return;
    if (this.ansi.size > 24) this.ansi.delete(this.ansi.keys().next().value!);
    const row: LogRow = { id: ++this.logId, time: Date.now(), kind, text: plain, spans, jobId };
    const logs = [...this.state.logs, row];
    this.logBytes += plain.length;
    while (logs.length > 1000 || this.logBytes > 160000) this.logBytes -= logs.shift()!.text.length;
    this.publish({ logs });
  }
  clearLogs() { this.logBytes = 0; this.publish({ logs: [] }); }
  acknowledgeUnknown() { this.publish({ unknown: [] }); }

  /** Call directly from a click handler: requestPort must retain user activation. */
  async connectFromGesture(api: SerialAPI | undefined = serialAPI()) {
    if (!api) throw new Error('当前浏览器不支持 Web Serial，请使用桌面 Chrome 或 Edge');
    if (this.state.connection !== 'disconnected') throw new Error('串口已打开，请先断开');
    const port = await api.requestPort();
    await this.connect(port);
  }

  async connect(port: SerialPortLike) {
    if (this.state.connection !== 'disconnected') throw new Error('串口已打开，请先断开');
    this.publish({ connection: 'connecting', error: null, info: null, files: [], storage: null, jobs: [] });
    const generation = ++this.generation;
    await this.cleanup;
    if (generation !== this.generation) throw new Error('连接已取消');
    this.port = port;
    try {
      await port.open({ baudRate: 115200, bufferSize: 65536 });
      if (generation !== this.generation) { await port.close(); throw new Error('连接已取消'); }
      // Release RTS before DTR: never intentionally pulse ESP reset lines.
      await port.setSignals?.({ requestToSend: false });
      await port.setSignals?.({ dataTerminalReady: false });
      if (!port.readable || !port.writable) throw new Error('串口读写流不可用');
      this.reader = port.readable.getReader();
      this.writer = port.writable.getWriter();
      this.writes = Promise.resolve();
      this.publish({ connection: 'serial-open' });
      this.readTask = this.readLoop(this.reader, generation);
      // A driver can reset the board on open; only read-only discovery is retried.
      let lastError: unknown;
      for (let attempt = 0; attempt < 3 && generation === this.generation; attempt++) {
        try { await this.info(Math.min(this.timeoutMs, 1600)); return; }
        catch (error) { lastError = error; if (!this.writer) break; }
      }
      throw lastError ?? new Error('设备在识别期间断开');
    } catch (error) {
      if (generation === this.generation && this.reader && this.writer) {
        // Keep plain serial logging available, but never enable device actions.
        const message = `串口已打开，尚未识别 Ryzobee：${error instanceof Error ? error.message : String(error)}`;
        this.publish({ connection: 'serial-open', error: message });
        this.message(message, 'error');
      } else if (generation === this.generation) {
        await this.disconnect();
        this.publish({ error: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  }

  async disconnect() {
    ++this.generation;
    this.rejectPending();
    const reader = this.reader, writer = this.writer, port = this.port, task = this.readTask;
    this.reader = null; this.writer = null; this.port = null; this.readTask = null;
    this.publish({ connection: 'disconnected', info: null, files: [], storage: null, jobs: [], error: null });
    this.output.clear(); this.ansi.clear();
    const previousCleanup = this.cleanup;
    this.cleanup = (async () => {
      await previousCleanup;
      try { await reader?.cancel(); } catch { /* USB unplug can close it first. */ }
      try { await task; } catch { /* readLoop reports transport errors. */ }
      await this.closeWriterAndPort(writer, port);
    })();
    await this.cleanup;
  }

  private async closeWriterAndPort(writer: WritableStreamDefaultWriter<Uint8Array> | null, port: SerialPortLike | null) {
    try { await writer?.abort(); } catch { /* Never flush queued mutations after disconnect. */ }
    try { writer?.releaseLock(); } catch { /* It may already be released. */ }
    try { await port?.close(); } catch {
      this.message('串口资源关闭未确认；若再次连接失败，请拔插设备或关闭占用串口的窗口。', 'error');
    }
  }

  private unknown(action: string) {
    const error = new UnknownResultError(action);
    this.publish({ unknown: [...new Set([...this.state.unknown, action])].slice(-20) });
    this.message(error.message, 'error');
    return error;
  }
  private rejectPending() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(request.mutation && request.sent ? this.unknown(request.action) : new Error('设备连接已断开；请求未完成'));
    }
    this.pending.clear();
  }
  private requireReady() {
    if (this.state.connection !== 'ready' || !this.state.info) throw new Error('请先连接并识别 Ryzobee 设备');
    return this.state.info;
  }

  private request(payload: Record<string, unknown>, mutation = false, timeout = this.timeoutMs, guard?: () => void): Promise<Reply> {
    const writer = this.writer;
    if (!writer) return Promise.reject(new Error('请先连接串口'));
    const id = `${this.prefix}-${++this.requestId}`;
    const data = encoder.encode(JSON.stringify({ ...payload, id }) + '\n');
    if (data.length >= 24 * 1024) return Promise.reject(new Error('编码后的请求超过固件 24 KiB 上限'));
    const action = String(payload.command ?? `${payload.action ?? payload.op} ${payload.name ?? ''}`).trim();
    const generation = this.generation;
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        reject(mutation && pending.sent ? this.unknown(action) : new Error(`${pending.sent ? '查询' : '发送'}超时：${action}`));
      }, timeout);
      const pending: Pending = { action, mutation, sent: false, resolve, reject, timer };
      this.pending.set(id, pending);
      this.writes = this.writes.catch(() => {}).then(async () => {
        if (generation !== this.generation || !this.pending.has(id)) return;
        guard?.();
        // A stream rejection can happen after a partial write; from here it is unknown.
        pending.sent = true;
        await writer.write(data);
      }).catch(error => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        reject(mutation && pending.sent ? this.unknown(action) : error instanceof Error ? error : new Error('串口写入失败'));
      });
    });
  }

  private applyJob(job: Job) {
    const old = this.state.jobs.find(item => item.job_id === job.job_id);
    if (old && old.state !== 'running' && job.state === 'running') return;
    const jobs = [job, ...this.state.jobs.filter(item => item.job_id !== job.job_id)];
    jobs.sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running'));
    this.publish({ jobs: jobs.slice(0, 20) });
  }

  private line(text: string) {
    if (!text) return;
    const rpc = text.startsWith('RYZOBEE_RPC '), event = text.startsWith('RYZOBEE_EVENT ');
    if (!rpc && !event) { this.message(text, 'system'); return; }
    let value: unknown;
    try { value = JSON.parse(text.slice(rpc ? 12 : 14)); }
    catch { this.message('已忽略损坏的设备帧', 'error'); return; }
    if (!record(value)) return;
    if (rpc) {
      if (typeof value.id !== 'string') return;
      const request = this.pending.get(value.id);
      if (!request) return;
      this.pending.delete(value.id); clearTimeout(request.timer);
      if (typeof value.ok !== 'boolean') {
        request.reject(request.mutation ? this.unknown(request.action) : new Error('设备响应格式错误'));
      } else if (!value.ok || value.store_commit === 'unknown') {
        const reason = typeof value.error === 'string' ? value.error : '设备拒绝请求';
        const message = reason.startsWith('busy: runtime owner has an active job')
          ? '设备脚本正在运行，请先点击文件区的“停止”，再读写文件。' : reason;
        request.reject(value.store_commit === 'unknown' ? this.unknown(request.action) : new Error(message));
      } else {
        if (isJob(value.job)) this.applyJob(value.job);
        if (Array.isArray(value.jobs)) value.jobs.filter(isJob).forEach(job => this.applyJob(job));
        if (value.store_commit === 'committed' && value.store_recovery_required === true)
          this.message('文件修改已提交，但存储清理尚未完成；请检查设备存储状态，不要重复提交。', 'error');
        request.resolve(value as Reply);
      }
    } else if (value.boot_id !== this.state.info?.boot_id) {
      // Unknown boot events cannot replace identity or revive old jobs.
      if (typeof value.boot_id === 'string' && this.state.info) {
        this.rejectPending();
        this.output.clear(); this.ansi.clear();
        this.publish({ connection: 'serial-open', info: null, jobs: [], files: [], storage: null });
        this.message('收到不同启动标识的事件，请重新识别设备。', 'system');
      }
    } else if (value.event === 'job' && isJob(value.job)) {
      this.applyJob(value.job);
      this.message(`${value.job.name} · ${value.job.state}${value.job.error ? `\n${value.job.error}` : ''}`, value.job.state === 'failed' ? 'error' : 'job', value.job.job_id);
      // Firmware prioritizes control events over queued output. A terminal job
      // can arrive between UTF-8 fragments; retain its bounded decoder until
      // disconnect/boot change or the 20-stream limit evicts it.
    } else if (value.event === 'output' && typeof value.job_id === 'string' && count(value.seq) && typeof value.data_b64 === 'string') {
      let stream = this.output.get(value.job_id);
      if (stream && value.seq <= stream.sequence) return;
      if (!stream || value.seq !== stream.sequence + 1) {
        if (value.seq > 0) this.message('脚本输出有丢帧，请查询任务查看丢弃计数。', 'system', value.job_id);
        stream = { decoder: new TextDecoder(), sequence: -1 };
        this.output.set(value.job_id, stream);
        if (this.output.size > 20) this.output.delete(this.output.keys().next().value!);
      }
      stream.sequence = value.seq;
      try {
        const bytes = Uint8Array.from(atob(value.data_b64), char => char.charCodeAt(0));
        const output = stream.decoder.decode(bytes, { stream: true });
        if (output) this.message(output, 'output', value.job_id);
      } catch { this.message('无法解码脚本输出帧', 'error', value.job_id); }
    }
  }

  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>, generation: number) {
    const decoder = new TextDecoder();
    let line = '', dropping = false;
    try {
      while (generation === this.generation) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const ch of decoder.decode(value, { stream: true })) {
          if (ch === '\r') continue;
          if (ch === '\n') { if (!dropping) this.line(line); line = ''; dropping = false; }
          else if (!dropping) {
            line += ch;
            if (line.length > 65536) { line = ''; dropping = true; this.message('设备帧超长，已丢弃至下一行', 'error'); }
          }
        }
      }
      if (line && !dropping && !line.startsWith('RYZOBEE_')) this.message(line, 'system');
    } catch (error) {
      if (generation === this.generation) this.message(`串口中断：${String(error)}`, 'error');
    } finally {
      reader.releaseLock();
      if (generation === this.generation) {
        ++this.generation;
        this.rejectPending();
        const writer = this.writer, port = this.port;
        this.reader = null; this.writer = null; this.port = null;
        this.output.clear(); this.ansi.clear();
        this.publish({ connection: 'disconnected', info: null, files: [], storage: null, jobs: [], error: '设备连接已断开' });
        this.message('设备已断开；未停止设备任务，重连不会自动重新执行。');
        this.cleanup = this.closeWriterAndPort(writer, port);
      }
    }
  }

  async info(timeout = this.timeoutMs): Promise<BoardInfo> {
    const generation = this.generation;
    const reply = await this.request({ op: 'info' }, false, timeout);
    if (generation !== this.generation) throw new Error('设备连接已改变');
    if (reply.protocol_version !== 2 || typeof reply.chip !== 'string' || typeof reply.firmware !== 'string' ||
        typeof reply.boot_id !== 'string' || !identifierPattern.test(reply.boot_id)) throw new Error('未收到 Ryzobee 协议 v2 设备信息');
    const info = reply as unknown as BoardInfo;
    if (this.state.info && this.state.info.boot_id !== info.boot_id) {
      this.rejectPending();
      this.output.clear(); this.ansi.clear();
      this.publish({ jobs: [], files: [], storage: null });
      this.message('设备已重新启动，旧任务记录已清除。');
    }
    // An info snapshot is authoritative about which job remains active.
    const running = isJob(info.job) ? info.job.job_id : null;
    this.publish({ connection: 'ready', info, error: null, jobs: this.state.jobs.filter(job => job.state !== 'running' || job.job_id === running) });
    if (isJob(info.recent_job)) this.applyJob(info.recent_job);
    if (isJob(info.job)) this.applyJob(info.job);
    return info;
  }

  private async scripts(action: string, fields: Record<string, unknown> = {}, mutation = false, guard?: () => void) {
    const info = this.requireReady();
    const generation = this.generation;
    const reply = await this.request({ ...fields, op: 'scripts', schema: STORE_SCHEMA, boot_id: info.boot_id, action }, mutation, this.timeoutMs, guard);
    if (generation !== this.generation || this.state.info?.boot_id !== info.boot_id || reply.schema !== STORE_SCHEMA || reply.boot_id !== info.boot_id) {
      if (mutation) throw this.unknown(`${action} ${fields.name ?? ''}`.trim());
      throw new Error('文件存储响应与当前设备不一致，请重新识别设备');
    }
    return reply;
  }

  async list(): Promise<DeviceFile[]> {
    const files: DeviceFile[] = [];
    let revision = 0, total = 0;
    do {
      const reply = await this.scripts('catalog', { offset: files.length, limit: 16, revision });
      if (!Array.isArray(reply.files) || !count(reply.revision) || !reply.revision || !count(reply.total) || reply.total > 256 ||
          reply.offset !== files.length || reply.count !== reply.files.length || reply.files.length > 16 ||
          (revision && (reply.revision !== revision || reply.total !== total))) throw new Error('设备文件分页响应不一致');
      revision = reply.revision; total = reply.total;
      const page = reply.files.map(file);
      if ((!page.length && files.length < total) || files.length + page.length > total) throw new Error('设备文件分页不完整');
      for (const entry of page) {
        if (files.some(item => item.name === entry.name)) throw new Error('设备文件分页包含重复文件');
        files.push(entry);
      }
    } while (files.length < total);
    this.publish({ files });
    return files;
  }

  async storage(): Promise<StorageStatus> {
    const value = await this.scripts('status');
    if (typeof value.ready !== 'boolean' || typeof value.recovery_required !== 'boolean' || typeof value.capacity_valid !== 'boolean' || !count(value.revision) ||
        (value.capacity_valid ? !count(value.total_bytes) || !count(value.used_bytes) || value.used_bytes > value.total_bytes : value.total_bytes !== null || value.used_bytes !== null))
      throw new Error('设备存储状态响应无效');
    const status: StorageStatus = { ready: value.ready, recovery_required: value.recovery_required, capacity_valid: value.capacity_valid,
      total_bytes: value.total_bytes as number | null, used_bytes: value.used_bytes as number | null, revision: value.revision };
    this.publish({ storage: status });
    return status;
  }

  async get(name: string): Promise<FileSource> {
    this.requireReady(); this.checkName(name);
    const generation = this.generation;
    // Firmware deliberately keeps source reads in the unversioned get operation.
    const reply = await this.request({ op: 'get', name });
    if (reply.name !== name || typeof reply.source !== 'string' || typeof reply.sha256 !== 'string' || !shaPattern.test(reply.sha256) ||
        reply.bytes !== encoder.encode(reply.source).length || await sourceHash(reply.source) !== reply.sha256) throw new Error('下载的 Lua 文件完整性校验失败');
    if (generation !== this.generation) throw new Error('下载期间设备连接已改变');
    return { name, source: reply.source, sha256: reply.sha256, bytes: reply.bytes as number };
  }

  async describe(name: string): Promise<FileDescription> {
    this.checkName(name);
    const reply = await this.scripts('describe', { name });
    if (reply.name !== name || typeof reply.sha256 !== 'string' || !shaPattern.test(reply.sha256)) throw new Error('文件版本响应无效');
    return { ...file(reply), sha256: reply.sha256,
      created_at: typeof reply.created_at === 'string' ? reply.created_at : null,
      modified_at: typeof reply.modified_at === 'string' ? reply.modified_at : null };
  }

  async upload(name: string, source: string, previousSha256 = '', guard?: () => void): Promise<string> {
    const info = this.requireReady(); this.checkName(name, true); this.checkPrevious(previousSha256, true);
    const bytes = encoder.encode(source).length;
    const limit = Math.min(info.source_limit_bytes ?? 16384, 16384);
    if (!bytes || bytes > limit || source.includes('\0')) throw new Error(`源码必须为 1..${limit} 字节，不能包含 NUL`);
    const generation = this.generation;
    const sha256 = await sourceHash(source);
    if (generation !== this.generation || this.state.info?.boot_id !== info.boot_id) throw new Error('设备连接已改变，未发送文件');
    const reply = await this.scripts('put', { name, source, sha256, previous_sha256: previousSha256 }, true, guard);
    if (reply.store_commit !== 'committed' || reply.sha256 !== sha256 || reply.bytes !== bytes) throw this.unknown(`上传 ${name}`);
    this.message(`已发送 ${name} · ${bytes} B`, 'system');
    return sha256;
  }

  async remove(name: string, previousSha256: string): Promise<void> {
    this.checkName(name, true); this.checkPrevious(previousSha256, false);
    const reply = await this.scripts('remove', { name, previous_sha256: previousSha256 }, true);
    if (reply.store_commit !== 'committed') throw this.unknown(`删除 ${name}`);
    this.publish({ files: this.state.files.filter(entry => entry.name !== name) });
    this.message(`已删除 ${name}`, 'system');
  }

  private checkName(name: string, mutation = false) {
    if (!validFilename(name)) throw new Error('文件名需为 1..36 位字母、数字、_、-，以 .lua 结尾');
    if (mutation && this.state.files.some(entry => entry.name === name && entry.protected)) throw new Error('此文件受设备保护');
  }
  private checkPrevious(hash: string, allowAbsent: boolean) {
    if (!(allowAbsent && hash === '') && !shaPattern.test(hash)) throw new Error('请先读取文件版本，再确认覆盖或删除');
  }

  async command(command: string, guard?: () => void) {
    this.requireReady();
    if (!command.trim() || /[\r\n\0]/.test(command) || encoder.encode(command).length > 512) throw new Error('Console 命令必须为 1..512 字节的单行文本');
    const readOnly = /^(help|board\s+info|lua\s+--jobs|lua\s+--job\s+[A-Za-z0-9_.:-]+)\s*$/.test(command.trim());
    this.message(command, 'command');
    const reply = await this.request({ op: 'console', command }, !readOnly, this.timeoutMs, guard);
    if (typeof reply.output === 'string') this.message(reply.output, 'system');
    return reply;
  }
  async run(name: string, guard?: () => void) { this.checkName(name); return this.command(`lua --run-async --path ${name}`, guard); }
  async stop(jobId: string, guard?: () => void) {
    if (!identifierPattern.test(jobId)) throw new Error('任务编号无效');
    return this.command(`lua --stop ${jobId}`, guard);
  }
  async jobs() { return this.command('lua --jobs'); }
}
