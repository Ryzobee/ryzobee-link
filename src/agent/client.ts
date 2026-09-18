import {
  JSONRPCNotificationSchema, JSONRPCRequestSchema, JSONRPCResponseSchema,
  type JSONRPCNotification, type JSONRPCRequest, type JSONRPCResponse,
} from '@modelcontextprotocol/sdk/types.js';
import { MCP_VERSION, ROUTE_META, channelName, type OwnerSummary } from '../commands/protocol';

export type ClientMessage = JSONRPCRequest | JSONRPCNotification;
export type RequestId = JSONRPCRequest['id'];
export interface AgentInterface {
  readonly clientId: string;
  discover(): Promise<OwnerSummary[]>;
  connect(sessionId: string): Promise<JSONRPCResponse>;
  request(sessionId: string, message: ClientMessage): Promise<JSONRPCResponse | undefined>;
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
  catch { /* This page remains usable without browser storage. */ }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function validateMessage(value: unknown): ClientMessage {
  const parsed = isRecord(value) && Object.hasOwn(value, 'id')
    ? JSONRPCRequestSchema.safeParse(value) : JSONRPCNotificationSchema.safeParse(value);
  if (!parsed.success) throw new Error('请输入标准 MCP JSON-RPC 2.0 请求或通知；请求 id 为字符串或整数，通知省略 id。');
  return parsed.data;
}
export function parseMessage(text: string): ClientMessage { return validateMessage(JSON.parse(text)); }

type Route = { clientId: string; sessionId: string; owner?: OwnerSummary; initialized?: boolean };
function routeOf(response: JSONRPCResponse): Route | null {
  const container = 'result' in response ? response.result._meta : response.error.data;
  const route = isRecord(container) ? container[ROUTE_META] : undefined;
  if (!isRecord(route) || typeof route.clientId !== 'string' || typeof route.sessionId !== 'string') return null;
  return route as Route;
}
export function ownerOf(response: JSONRPCResponse): OwnerSummary | null {
  const route = routeOf(response), owner = route?.owner;
  if (!isRecord(owner) || owner.version !== 1 || owner.sessionId !== route?.sessionId
    || typeof owner.title !== 'string' || typeof owner.connection !== 'string'
    || !['none', 'pending', 'granted'].includes(String(owner.control))
    || (owner.clientId !== undefined && typeof owner.clientId !== 'string')) return null;
  return owner as unknown as OwnerSummary;
}
const requestKey = (sessionId: string, id: RequestId) => JSON.stringify([sessionId, typeof id, id]);

export class TransportUnknownError extends Error {
  constructor(readonly sessionId: string, readonly requestId: RequestId) {
    super(`等待 MCP 响应超时，结果未知。请查询原请求 id ${JSON.stringify(requestId)}，不要重发写入或运行。`);
    this.name = 'TransportUnknownError';
  }
}
export class McpResponseError extends Error {
  constructor(readonly response: JSONRPCResponse) {
    super('error' in response ? response.error.message : 'MCP 初始化响应无效。');
    this.name = 'McpResponseError';
  }
}

/** Raw MCP JSON-RPC over a same-origin browser transport. */
export class AgentClient implements AgentInterface {
  readonly clientId: string;
  private readonly channel: BroadcastChannel | null;
  private readonly pending = new Map<string, (response: JSONRPCResponse) => void>();
  private readonly discoveries = new Map<RequestId, (response: JSONRPCResponse) => void>();
  private readonly initialized = new Set<string>();
  private readonly negotiated = new Set<string>();
  private readonly connections = new Map<string, Promise<JSONRPCResponse>>();
  private readonly catalogs = new Map<string, JSONRPCResponse>();

  constructor() {
    this.clientId = readSession('clientId') || crypto.randomUUID();
    writeSession('clientId', this.clientId);
    this.channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(channelName()) : null;
    this.channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
      const parsed = JSONRPCResponseSchema.safeParse(event.data);
      if (!parsed.success) return;
      const response = parsed.data, route = routeOf(response);
      if (!route || route.clientId !== this.clientId || response.id === undefined) return;
      this.discoveries.get(response.id)?.(response);
      this.pending.get(requestKey(route.sessionId, response.id))?.(response);
    });
  }

  private send(sessionId: string | undefined, message: ClientMessage): void {
    if (!this.channel) throw new Error('此浏览器不支持 BroadcastChannel，无法连接同源 MCP 会话。');
    this.channel.postMessage({ ...message, params: { ...message.params,
      _meta: { ...message.params?._meta, [ROUTE_META]: { clientId: this.clientId, ...(sessionId ? { sessionId } : {}) } } } });
  }

  discover(): Promise<OwnerSummary[]> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const owners = new Map<string, OwnerSummary>();
      const timer = setTimeout(() => {
        this.discoveries.delete(id);
        resolve([...owners.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId)));
      }, 1000);
      this.discoveries.set(id, response => {
        const owner = ownerOf(response);
        if (owner) owners.set(owner.sessionId, owner);
      });
      try { this.send(undefined, { jsonrpc: '2.0', id, method: 'ping' }); }
      catch (error) { clearTimeout(timer); this.discoveries.delete(id); reject(error); }
    });
  }

  async request(sessionId: string, input: ClientMessage): Promise<JSONRPCResponse | undefined> {
    if (!sessionId) throw new Error('请先选择 LINK 会话。');
    const message = validateMessage(input);
    if (!('id' in message)) {
      this.send(sessionId, message);
      if (message.method === 'notifications/initialized' && this.negotiated.has(sessionId)) this.initialized.add(sessionId);
      return undefined;
    }
    const key = requestKey(sessionId, message.id);
    if (this.pending.has(key)) throw new Error('此 JSON-RPC id 仍在等待响应，请使用新的 id 查询结果。');
    const response = await new Promise<JSONRPCResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new TransportUnknownError(sessionId, message.id));
      }, 15000);
      this.pending.set(key, reply => { clearTimeout(timer); this.pending.delete(key); resolve(reply); });
      try { this.send(sessionId, message); }
      catch (error) { clearTimeout(timer); this.pending.delete(key); reject(error); }
    });
    if (message.method === 'initialize' && 'result' in response) {
      if (response.result.protocolVersion !== MCP_VERSION) throw new McpResponseError(response);
      this.negotiated.add(sessionId);
      this.initialized.delete(sessionId);
      this.catalogs.delete(sessionId);
    }
    return response;
  }

  connect(sessionId: string): Promise<JSONRPCResponse> {
    const previous = this.connections.get(sessionId);
    if (previous) return previous;
    const catalog = this.catalogs.get(sessionId);
    if (catalog && this.initialized.has(sessionId)) return Promise.resolve(catalog);
    const connection = (async () => {
      // A refreshed companion page keeps its clientId and may resume the live
      // server connection. Do not send a second initialize to that MCP session.
      if (!this.negotiated.has(sessionId)) {
        const ping = await this.request(sessionId, { jsonrpc: '2.0', id: crypto.randomUUID(), method: 'ping' });
        if (!ping) throw new Error('未收到 MCP 会话响应。');
        if ('error' in ping) throw new McpResponseError(ping);
        if (routeOf(ping)?.initialized) { this.negotiated.add(sessionId); this.initialized.add(sessionId); }
      }
      if (!this.negotiated.has(sessionId)) {
        const response = await this.request(sessionId, { jsonrpc: '2.0', id: crypto.randomUUID(), method: 'initialize', params: {
          protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: 'ryzobee-link-agent', version: '1.0.0' },
        } });
        if (!response) throw new Error('未收到 MCP 初始化响应。');
        if ('error' in response) throw new McpResponseError(response);
      }
      if (!this.initialized.has(sessionId)) await this.request(sessionId, { jsonrpc: '2.0', method: 'notifications/initialized' });
      const response = await this.request(sessionId, { jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/list', params: {} });
      if (!response) throw new Error('未收到 MCP 工具列表。');
      if ('error' in response) throw new McpResponseError(response);
      this.catalogs.set(sessionId, response);
      return response;
    })();
    this.connections.set(sessionId, connection);
    void connection.finally(() => { if (this.connections.get(sessionId) === connection) this.connections.delete(sessionId); }).catch(() => {});
    return connection;
  }
}
