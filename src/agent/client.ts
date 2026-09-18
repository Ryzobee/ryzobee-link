import {
  PROTOCOL_VERSION, channelName,
  type BridgeRequest, type BridgeResponse, type CommandReply, type CommandRequest, type OwnerSummary,
} from '../commands/protocol';

export interface AgentCommand {
  sessionId: string;
  requestId: string;
  command: string;
  args?: Record<string, unknown>;
  expiresAt?: number;
}

export interface AgentInterface {
  readonly clientId: string;
  discover(): Promise<OwnerSummary[]>;
  requestControl(input: { sessionId: string; label?: string }): Promise<OwnerSummary>;
  execute(input: AgentCommand): Promise<CommandReply>;
  result(input: { sessionId: string; requestId: string }): Promise<CommandReply>;
}

declare global {
  interface Window { ryzobeeLinkAgent?: AgentInterface }
}

export const storagePrefix = `ryzobee-link-agent:${new URL(import.meta.env.BASE_URL, location.href).pathname}:`;

export function readSession(key: string): string | null {
  try { return sessionStorage.getItem(storagePrefix + key); }
  catch { return null; }
}

export function writeSession(key: string, value: string): void {
  try { sessionStorage.setItem(storagePrefix + key, value); }
  catch { /* The client still works in memory when storage is unavailable. */ }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) {
    throw new Error(`${field} 必须为 1–128 位字母、数字、_、.、: 或 -。`);
  }
}

function validateCommand(value: unknown): Omit<AgentCommand, 'sessionId'> {
  if (!isRecord(value)) throw new Error('命令 JSON 必须是对象。');
  validateIdentifier(value.requestId, 'requestId');
  if (typeof value.command !== 'string' || !value.command.trim()) throw new Error('请填写 command。');
  if (value.args !== undefined && !isRecord(value.args)) throw new Error('args 必须是 JSON 对象。');
  if (value.expiresAt !== undefined && (typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt))) {
    throw new Error('expiresAt 必须是安全整数毫秒时间戳。');
  }
  return {
    requestId: value.requestId,
    command: value.command,
    args: value.args,
    expiresAt: value.expiresAt,
  };
}

export function parseCommand(text: string): Omit<AgentCommand, 'sessionId'> {
  return validateCommand(JSON.parse(text));
}

function isOwner(value: unknown): value is OwnerSummary {
  return isRecord(value) && value.version === PROTOCOL_VERSION && typeof value.sessionId === 'string'
    && typeof value.title === 'string' && typeof value.connection === 'string'
    && ['none', 'pending', 'granted'].includes(String(value.control))
    && (value.clientId === undefined || typeof value.clientId === 'string');
}

function isReply(value: unknown): value is CommandReply {
  return isRecord(value) && value.version === PROTOCOL_VERSION && typeof value.sessionId === 'string'
    && typeof value.requestId === 'string' && typeof value.ok === 'boolean'
    && ['completed', 'accepted', 'rejected', 'unknown'].includes(String(value.status));
}

export class AgentClient implements AgentInterface {
  readonly clientId: string;
  private readonly channel: BroadcastChannel | null;
  private readonly pending = new Map<string, (response: BridgeResponse) => void>();

  constructor() {
    this.clientId = readSession('clientId') || crypto.randomUUID();
    writeSession('clientId', this.clientId);
    this.channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(channelName()) : null;
    this.channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (!isRecord(value) || value.type !== 'link-command-response' || value.version !== PROTOCOL_VERSION
        || value.clientId !== this.clientId || typeof value.transportId !== 'string'
        || typeof value.sessionId !== 'string' || (!isOwner(value.data) && !isReply(value.data))
        || value.data.sessionId !== value.sessionId) return;
      this.pending.get(value.transportId)?.(value as BridgeResponse);
    });
  }

  private message(action: BridgeRequest['action'], details: Partial<BridgeRequest> = {}): BridgeRequest {
    return { ...details, type: 'link-command-request', version: PROTOCOL_VERSION,
      transportId: crypto.randomUUID(), clientId: this.clientId, action };
  }

  private send(message: BridgeRequest): void {
    if (!this.channel) throw new Error('此浏览器不支持同源会话通信，请使用支持 BroadcastChannel 的浏览器。');
    this.channel.postMessage(message);
  }

  discover(): Promise<OwnerSummary[]> {
    const message = this.message('discover');
    return new Promise((resolve, reject) => {
      const owners = new Map<string, OwnerSummary>();
      const timer = setTimeout(() => {
        this.pending.delete(message.transportId);
        resolve([...owners.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId)));
      }, 1000);
      this.pending.set(message.transportId, response => {
        if (isOwner(response.data)) owners.set(response.sessionId, response.data);
      });
      try { this.send(message); }
      catch (error) { clearTimeout(timer); this.pending.delete(message.transportId); reject(error); }
    });
  }

  private exchange<T extends OwnerSummary | CommandReply>(
    message: BridgeRequest, matches: (value: OwnerSummary | CommandReply) => value is T,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.transportId);
        reject(new Error('等待响应超时，结果未知。请保留 requestId 并查询结果。'));
      }, 15000);
      this.pending.set(message.transportId, response => {
        if (response.sessionId !== message.sessionId || !matches(response.data)) return;
        clearTimeout(timer);
        this.pending.delete(message.transportId);
        resolve(response.data);
      });
      try { this.send(message); }
      catch (error) { clearTimeout(timer); this.pending.delete(message.transportId); reject(error); }
    });
  }

  requestControl(input: { sessionId: string; label?: string }): Promise<OwnerSummary> {
    return this.exchange(this.message('control', { sessionId: input.sessionId, label: input.label }), isOwner);
  }

  private async commandReply(message: BridgeRequest, requestId: string): Promise<CommandReply> {
    try {
      return await this.exchange(message, (value): value is CommandReply => isReply(value) && value.requestId === requestId);
    } catch (error) {
      return { version: PROTOCOL_VERSION, sessionId: message.sessionId!, requestId, ok: false, status: 'unknown',
        error: { code: 'TRANSPORT_UNKNOWN', message: error instanceof Error ? error.message : String(error) } };
    }
  }

  private invalidReply(input: unknown, error: unknown): CommandReply {
    return { version: PROTOCOL_VERSION,
      sessionId: isRecord(input) && typeof input.sessionId === 'string' ? input.sessionId : '',
      requestId: isRecord(input) && typeof input.requestId === 'string' ? input.requestId : '',
      ok: false, status: 'rejected',
      error: { code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error) } };
  }

  async execute(input: AgentCommand): Promise<CommandReply> {
    try {
      const command = validateCommand(input);
      validateIdentifier(input.sessionId, 'sessionId');
      const request: CommandRequest = { ...command,
        version: PROTOCOL_VERSION, sessionId: input.sessionId, clientId: this.clientId };
      return this.commandReply(this.message('execute', { sessionId: input.sessionId, request }), command.requestId);
    } catch (error) { return this.invalidReply(input, error); }
  }

  async result(input: { sessionId: string; requestId: string }): Promise<CommandReply> {
    try {
      validateIdentifier(input.sessionId, 'sessionId');
      validateIdentifier(input.requestId, 'requestId');
      return this.commandReply(this.message('result', input), input.requestId);
    } catch (error) { return this.invalidReply(input, error); }
  }
}
