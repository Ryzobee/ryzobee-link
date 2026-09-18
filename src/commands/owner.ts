import { channelName, type BridgeRequest, type CommandReply, type CommandRequest, type LinkPageInterface, type OwnerSummary } from './protocol';

export class CommandError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export type ControlState = { pending: { clientId: string; label: string } | null; grant: { clientId: string; label: string } | null; reason: string };
export type OperationResult = { data: unknown; accepted?: boolean };
export interface CommandBackend {
  identity(): { connection: string; boot: string | null; epoch: number };
  execute(command: string, args: Record<string, unknown>, guard: () => void): Promise<OperationResult>;
}
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
};
async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** One live page, one human grant, bounded idempotency ledger. No durable authority. */
export class CommandOwner implements LinkPageInterface {
  readonly sessionId = crypto.randomUUID();
  private state: ControlState = { pending: null, grant: null, reason: '' };
  private listeners = new Set<() => void>();
  private generation = 0;
  private bound: { boot: string; epoch: number } | null = null;
  private records = new Map<string, { fingerprint: string; promise?: Promise<CommandReply>; reply?: CommandReply }>();
  constructor(private backend: CommandBackend) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<ControlState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  checkIdentity = () => {
    if (!this.state.grant) return;
    const identity = this.backend.identity();
    if (this.bound && (identity.connection !== 'ready' || identity.boot !== this.bound.boot || identity.epoch !== this.bound.epoch)) {
      this.revoke('设备连接或启动标识已改变，请重新授权');
    } else if (!this.bound && identity.connection === 'ready' && identity.boot) this.bound = { boot: identity.boot, epoch: identity.epoch };
  };
  hello = (): OwnerSummary => {
    this.checkIdentity();
    return { version: 1, sessionId: this.sessionId, title: 'RYZOBEE LINK', connection: this.backend.identity().connection,
      control: this.state.grant ? 'granted' : this.state.pending ? 'pending' : 'none', clientId: this.state.grant?.clientId ?? this.state.pending?.clientId };
  };
  requestControl = ({ clientId, label }: { clientId: string; label?: string }): OwnerSummary => {
    if (!identifier(clientId)) throw new CommandError('INVALID_REQUEST', 'clientId 无效');
    this.checkIdentity();
    if (!this.state.grant && !this.state.pending) this.publish({ pending: { clientId, label: typeof label === 'string' ? label.slice(0, 80) : '本地 AI' }, reason: '' });
    return this.hello();
  };
  /** Only bound to the user's main-page approval button, never the command interface. */
  approve() {
    const grant = this.state.pending;
    if (!grant) return;
    this.generation++;
    this.bound = null;
    this.publish({ grant, pending: null, reason: '' });
    this.checkIdentity();
  }
  revoke(reason = '已结束 AI 控制') { this.generation++; this.bound = null; this.publish({ grant: null, pending: null, reason }); }
  private assert(clientId: string, sessionId: string) {
    this.checkIdentity();
    if (sessionId !== this.sessionId) throw new CommandError('SESSION_CHANGED', '页面已重新加载，请重新发现会话');
    if (this.state.grant?.clientId !== clientId) throw new CommandError('NEEDS_APPROVAL', '请在用户页面允许本次 AI 控制');
  }
  private failure(requestId: string, error: unknown): CommandReply {
    const unknown = error instanceof Error && error.name === 'UnknownResultError';
    return { version: 1, sessionId: this.sessionId, requestId, ok: false, status: unknown ? 'unknown' : 'rejected',
      error: { code: unknown ? 'RESULT_UNKNOWN' : error instanceof CommandError ? error.code : 'OPERATION_FAILED', message: error instanceof Error ? error.message : String(error) } };
  }
  execute = async (input: CommandRequest): Promise<CommandReply> => {
    let requestId = object(input) && typeof input.requestId === 'string' ? input.requestId.slice(0, 256) : '';
    try {
      if (!object(input) || input.version !== 1 || !identifier(input.requestId) || !identifier(input.clientId) || typeof input.command !== 'string' ||
        (input.args !== undefined && !object(input.args)) || (input.expiresAt !== undefined && !Number.isSafeInteger(input.expiresAt)))
        throw new CommandError('INVALID_REQUEST', '命令必须包含 version、sessionId、clientId、requestId、command 和 args 对象');
      requestId = input.requestId;
      this.assert(input.clientId, input.sessionId);
      const serialized = JSON.stringify(input);
      if (serialized.length > 1200000) throw new CommandError('REQUEST_TOO_LARGE', '请求超过大小限制');
      // Snapshot caller-owned objects before yielding; JS callers may reuse them.
      const request: CommandRequest = JSON.parse(serialized);
      const generation = this.generation;
      const key = request.clientId + '/' + request.requestId;
      const fingerprint = await digest({ command: request.command, args: request.args ?? {} });
      this.assert(request.clientId, request.sessionId);
      if (generation !== this.generation) throw new CommandError('CONTROL_REVOKED', '本次控制已撤销，未继续执行');
      const previous = this.records.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new CommandError('REQUEST_CONFLICT', 'requestId 已用于不同命令，请勿重复使用');
        return previous.promise ?? Promise.resolve(previous.reply ?? this.failure(requestId, new CommandError('RESULT_EXPIRED', '结果已移出缓存；此请求不会重复执行，请查询实际状态')));
      }
      if (this.records.size >= 1024) throw new CommandError('SESSION_LIMIT', '本页面已达到 1024 次命令上限，请核对状态后重新加载并授权');
      const deadline = request.expiresAt ?? Date.now() + 60000;
      const guard = () => {
        this.assert(request.clientId, request.sessionId);
        if (generation !== this.generation) throw new CommandError('CONTROL_REVOKED', '本次控制已撤销，未继续执行');
        if (Date.now() > deadline) throw new CommandError('REQUEST_EXPIRED', '命令已过期，未继续执行');
      };
      const entry: { fingerprint: string; promise?: Promise<CommandReply>; reply?: CommandReply } = { fingerprint };
      this.records.set(key, entry);
      entry.promise = Promise.resolve().then(async () => {
        guard();
        const result = await this.backend.execute(request.command, request.args ?? {}, guard);
        return { version: 1 as const, sessionId: this.sessionId, requestId, ok: true, status: result.accepted ? 'accepted' as const : 'completed' as const, data: result.data };
      }).catch(error => this.failure(requestId, error)).then(reply => {
        entry.reply = reply; entry.promise = undefined;
        // Keep fingerprints for the whole page lifetime; eviction must never replay a write.
        const completed = [...this.records.values()].filter(record => record.reply);
        for (const record of completed.slice(0, -64)) record.reply = undefined;
        return reply;
      });
      return entry.promise;
    } catch (error) { return Promise.resolve(this.failure(requestId, error)); }
  };
  result = ({ sessionId, clientId, requestId }: { sessionId: string; clientId: string; requestId: string }): CommandReply => {
    try {
      this.assert(clientId, sessionId);
      const entry = this.records.get(clientId + '/' + requestId);
      if (!entry) throw new CommandError('NOT_SEEN', '未找到请求记录；请先检查目标状态，不要自动重发写入');
      if (entry.reply) return entry.reply;
      if (entry.promise) return { version: 1, sessionId, requestId, ok: true, status: 'accepted', data: { pending: true } };
      throw new CommandError('RESULT_EXPIRED', '结果已移出缓存；请查询实际状态，此请求不会再次执行');
    } catch (error) { return this.failure(requestId, error); }
  };
  attach() {
    const api: LinkPageInterface = Object.freeze({ hello: this.hello, requestControl: this.requestControl, execute: this.execute, result: this.result });
    window.ryzobeeLink = api;
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName());
    let disposed = false;
    if (channel) channel.onmessage = async ({ data }: MessageEvent<BridgeRequest>) => {
      if (!object(data) || data.type !== 'link-command-request' || data.version !== 1 || !identifier(data.transportId) || !identifier(data.clientId)) return;
      if (data.action !== 'discover' && data.sessionId !== this.sessionId) return;
      let reply: OwnerSummary | CommandReply;
      try {
        switch (data.action) {
          case 'discover': reply = this.hello(); break;
          case 'control': reply = this.requestControl(data); break;
          case 'execute':
            if (!data.request || data.request.clientId !== data.clientId || data.request.sessionId !== data.sessionId) throw new CommandError('INVALID_REQUEST', '请求会话不匹配');
            reply = await this.execute(data.request); break;
          case 'result': reply = this.result({ sessionId: this.sessionId, clientId: data.clientId, requestId: data.requestId ?? '' }); break;
          default: return;
        }
      } catch (error) { reply = this.failure(data.requestId ?? '', error); }
      if (!disposed) channel.postMessage({ type: 'link-command-response', version: 1, transportId: data.transportId, clientId: data.clientId, sessionId: this.sessionId, data: reply });
    };
    return () => { disposed = true; channel?.close(); if (window.ryzobeeLink === api) delete window.ryzobeeLink; this.revoke('页面已关闭'); };
  }
}
