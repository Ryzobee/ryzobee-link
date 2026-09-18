import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, InitializeRequestSchema, InitializedNotificationSchema, CancelledNotificationSchema, JSONRPCMessageSchema, ErrorCode, McpError,
  type JSONRPCMessage, type CallToolResult, type Tool, type RequestId } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CommandOwner } from './owner';
import { catalog } from './kernel';
import { channelName, MCP_VERSION, ROUTE_META, type CommandReply, type McpResponse } from './protocol';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isId = (value: unknown): value is RequestId => typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));
const idKey = (id: RequestId) => JSON.stringify(id);
async function operationKey(id: RequestId) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(idKey(id)));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function result(data: unknown, status = 'completed', error?: { code: string; message: string }): CallToolResult {
  let value = data;
  const content: CallToolResult['content'] = [];
  if (object(data) && typeof data.dataUrl === 'string' && data.dataUrl.startsWith('data:image/png;base64,')) {
    const { dataUrl, ...metadata } = data;
    value = metadata;
    content.push({ type: 'image', mimeType: 'image/png', data: dataUrl.slice('data:image/png;base64,'.length) });
  }
  const structuredContent = { status, ...(value === undefined ? {} : { data: value }), ...(error ? { error } : {}) };
  content.unshift({ type: 'text', text: JSON.stringify(structuredContent) });
  return { content, structuredContent, isError: !!error };
}
const fromOperation = (reply: CommandReply) => result(reply.data, reply.status, reply.error);
const controlTools: Tool[] = [
  { name: 'link.request_control', description: 'Ask the human to allow this MCP client on the main page. Does not grant permission itself.',
    inputSchema: { type: 'object', properties: { label: { type: 'string', maxLength: 80 } }, additionalProperties: false } },
  { name: 'link.control_status', description: 'Read this page’s control state. No workspace or device data.',
    inputSchema: { type: 'object', additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'link.request_result', description: 'Query an earlier workspace, simulator, device, logs or link.status operation by its original JSON-RPC id. Control tools are not recorded. Use a NEW RPC id for this query; never replay a mutation.',
    inputSchema: { type: 'object', properties: { requestId: { type: ['string', 'integer'] } }, required: ['requestId'], additionalProperties: false }, annotations: { readOnlyHint: true } },
];
export const mcpTools: Tool[] = [...controlTools, ...Object.entries(catalog).filter(([name]) => name !== 'help').map(([name, entry]): Tool => ({
  name, description: entry.description,
  inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(entry.args).map(([key, type]) => [key, { type: type.replace('?', '') }])),
    required: Object.entries(entry.args).filter(([, type]) => !type.endsWith('?')).map(([key]) => key), additionalProperties: false },
  annotations: { readOnlyHint: ['link.status', 'workspace.list', 'workspace.read', 'simulator.status', 'simulator.capture', 'device.info', 'device.files', 'device.read', 'device.jobs', 'logs.read'].includes(name),
    destructiveHint: ['workspace.update', 'workspace.close', 'device.upload', 'device.run', 'device.stop', 'simulator.run', 'simulator.stop'].includes(name), openWorldHint: name.startsWith('device.') },
}))];

/** SDK transport inside a single page. Wire framing is handled by the browser adapter. */
class PageTransport implements Transport {
  onmessage?: Transport['onmessage'];
  onclose?: () => void;
  onerror?: (error: Error) => void;
  pending = new Map<string, (message: McpResponse | undefined) => void>();
  async start() {}
  async send(message: JSONRPCMessage) {
    if (!('id' in message) || (!('result' in message) && !('error' in message))) return;
    const key = idKey(message.id!);
    const resolve = this.pending.get(key);
    this.pending.delete(key);
    resolve?.(message);
  }
  cancel(id: RequestId) { const key = idKey(id); this.pending.get(key)?.(undefined); this.pending.delete(key); }
  async close() { this.onclose?.(); for (const resolve of this.pending.values()) resolve(undefined); this.pending.clear(); }
  receive(message: JSONRPCMessage): Promise<McpResponse | undefined> {
    if (!('id' in message)) { this.onmessage?.(message); return Promise.resolve(undefined); }
    return new Promise(resolve => { this.pending.set(idKey(message.id!), resolve); this.onmessage?.(message); });
  }
}
type Peer = { server: Server; transport: PageTransport; ready: boolean; initialized: boolean; initializing: boolean; ids: Set<string> };

/** MCP 2025-11-25 server. Only the transport route uses namespaced MCP metadata. */
export class BrowserMcpServer {
  private peers = new Map<string, Peer>();
  private channel: BroadcastChannel | null = null;
  constructor(private owner: CommandOwner) {}
  private async peer(clientId: string) {
    let peer = this.peers.get(clientId);
    if (peer) return peer;
    if (this.peers.size >= 16) throw new McpError(ErrorCode.InvalidRequest, '本页面 MCP 客户端已达上限，请核对设备状态后重新加载');
    const server = new Server({ name: 'ryzobee-link', version: '1.0.1' }, { capabilities: { tools: {} },
      instructions: 'Use link.request_control and wait for the human. Running device files never requires simulation. Query uncertain operations via link.request_result with a fresh RPC id.' });
    const transport = new PageTransport();
    peer = { server, transport, ready: false, initialized: false, initializing: false, ids: new Set() };
    this.peers.set(clientId, peer);
    server.setRequestHandler(ListToolsRequestSchema, request => {
      if (request.params?.cursor !== undefined) throw new McpError(ErrorCode.InvalidParams, 'No pagination cursor is supported');
      return { tools: mcpTools };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      if (request.params.task !== undefined) throw new McpError(ErrorCode.InvalidParams, 'MCP Tasks are not supported by this server');
      const { name, arguments: args = {} } = request.params;
      if (!mcpTools.some(tool => tool.name === name)) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
      if (name === 'link.request_control') {
        if (Object.keys(args).some(key => key !== 'label') || (args.label !== undefined && (typeof args.label !== 'string' || args.label.length > 80))) return result(undefined, 'rejected', { code: 'INVALID_ARGUMENT', message: 'label 应为不超过 80 字的字符串' });
        return result(this.owner.requestControl({ clientId, label: args.label as string | undefined }));
      }
      if (name === 'link.control_status') {
        if (Object.keys(args).length) return result(undefined, 'rejected', { code: 'INVALID_ARGUMENT', message: '此工具无参数' });
        return result(this.owner.hello());
      }
      if (name === 'link.request_result') {
        if (!isId(args.requestId) || Object.keys(args).some(key => key !== 'requestId')) return result(undefined, 'rejected', { code: 'INVALID_ARGUMENT', message: 'requestId 应为原始 JSON-RPC 字符串或整数 ID' });
        return fromOperation(this.owner.result({ sessionId: this.owner.sessionId, clientId, requestId: await operationKey(args.requestId) }));
      }
      const controlEpoch = this.owner.getControlEpoch();
      const reply = await this.owner.execute({ version: 1, sessionId: this.owner.sessionId, clientId,
        requestId: await operationKey(extra.requestId), command: name, args }, () => extra.signal.aborted || controlEpoch !== this.owner.getControlEpoch());
      return fromOperation(reply);
    });
    await server.connect(transport);
    return peer;
  }
  request = async (input: unknown): Promise<McpResponse | undefined> => {
    let id: RequestId | undefined;
    let clientId = 'direct-browser';
    let notification = false;
    const route = () => ({ clientId, sessionId: this.owner.sessionId });
    const failure = (code: number, message: string): McpResponse | undefined => notification ? undefined : ({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), error: { code, message, data: { [ROUTE_META]: route() } } });
    try {
      if (typeof input === 'string') { try { input = JSON.parse(input); } catch { return failure(ErrorCode.ParseError, 'Invalid JSON'); } }
      if (object(input) && isId(input.id)) id = input.id;
      notification = object(input) && !('id' in input) && typeof input.method === 'string';
      const parsed = JSONRPCMessageSchema.safeParse(input);
      if (!parsed.success || !('method' in parsed.data)) return failure(ErrorCode.InvalidRequest, 'Expected an MCP JSON-RPC 2.0 request or notification');
      const message = parsed.data;
      const metadata = message.params?._meta;
      const routing = object(metadata) && object(metadata[ROUTE_META]) ? metadata[ROUTE_META] : {};
      if (routing.clientId !== undefined) {
        if (typeof routing.clientId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(routing.clientId)) return failure(ErrorCode.InvalidParams, 'Invalid browser transport clientId');
        clientId = routing.clientId;
      }
      if (routing.sessionId !== undefined && routing.sessionId !== this.owner.sessionId) return failure(ErrorCode.InvalidRequest, 'Browser session changed; rediscover the target');
      if (typeof id === 'string' && id.length > 256) return failure(ErrorCode.InvalidRequest, 'Request id exceeds 256 characters');
      if (JSON.stringify(message).length > 1200000) return failure(ErrorCode.InvalidRequest, 'Request too large');
      // SDK's generic dispatcher maps raw schema exceptions to InternalError.
      // Validate with its official schemas here to preserve InvalidParams.
      const schema = ({ initialize: InitializeRequestSchema, 'tools/list': ListToolsRequestSchema,
        'tools/call': CallToolRequestSchema, 'notifications/initialized': InitializedNotificationSchema,
        'notifications/cancelled': CancelledNotificationSchema })[message.method as 'initialize'];
      if (schema && !schema.safeParse(message).success) return failure(ErrorCode.InvalidParams, `Invalid parameters for ${message.method}`);
      // Reject before SDK task dispatch: this server does not advertise Tasks.
      if (message.method === 'tools/call' && message.params?.task !== undefined) return failure(ErrorCode.InvalidParams, 'MCP Tasks are not supported by this server');
      if (message.method === 'ping') {
        if (id === undefined) return undefined;
        const existing = this.peers.get(clientId);
        // Unscoped discovery is not part of a selected MCP session. Periodic
        // discovery must not exhaust an otherwise idle session's request budget.
        if (existing && routing.sessionId !== undefined) {
          if (existing.ids.has(idKey(id))) return failure(ErrorCode.InvalidRequest, 'JSON-RPC id already used');
          if (existing.ids.size >= 4096) return failure(ErrorCode.InvalidRequest, 'MCP request limit reached; reconnect after inspecting state');
          existing.ids.add(idKey(id));
        }
        return { jsonrpc: '2.0', id, result: { _meta: { [ROUTE_META]: { ...route(), owner: this.owner.hello(), initialized: !!existing?.ready } } } };
      }
      let peer = this.peers.get(clientId);
      if (message.method === 'initialize' && id !== undefined) {
        if (peer?.initialized || peer?.initializing) return failure(ErrorCode.InvalidRequest, 'Client already initialized; inspect ping transport metadata before resuming');
        peer = await this.peer(clientId);
        if (peer.initialized || peer.initializing) return failure(ErrorCode.InvalidRequest, 'Client already initializing');
        peer.initializing = true;
      }
      if (!peer) return id === undefined ? undefined : failure(ErrorCode.InvalidRequest, 'Send initialize first');
      if (id !== undefined) {
        const key = idKey(id);
        if (peer.ids.has(key)) return failure(ErrorCode.InvalidRequest, 'JSON-RPC id already used; query link.request_result with a new id');
        if (peer.ids.size >= 4096) return failure(ErrorCode.InvalidRequest, 'MCP request limit reached; reconnect after inspecting state');
        peer.ids.add(key);
      }
      if (message.method === 'notifications/initialized') { if (peer.initialized && id === undefined) peer.ready = true; }
      else if (message.method !== 'initialize' && !peer.ready && message.method !== 'notifications/cancelled') return id === undefined ? undefined : failure(ErrorCode.InvalidRequest, 'Send notifications/initialized before tool calls');
      // Negotiate this implementation's supported revision, while leaving the
      // SDK responsible for validating all required initialize parameters.
      const delivered = message.method === 'initialize' && typeof message.params?.protocolVersion === 'string'
        ? { ...message, params: { ...message.params, protocolVersion: MCP_VERSION } } : message;
      const response = await peer.transport.receive(delivered);
      if (message.method === 'notifications/cancelled' && id === undefined && isId(message.params?.requestId)) peer.transport.cancel(message.params.requestId);
      if (!response) return undefined;
      if (message.method === 'initialize') { peer.initializing = false; if ('result' in response) peer.initialized = true; }
      if ('result' in response) return { ...response, result: { ...response.result, _meta: { ...response.result._meta, [ROUTE_META]: route() } } };
      return { ...response, error: { ...response.error, data: { detail: response.error.data, [ROUTE_META]: route() } } };
    } catch (error) { return id === undefined ? undefined : failure(error instanceof McpError ? error.code : ErrorCode.InternalError, error instanceof Error ? error.message : String(error)); }
  };
  attach() {
    const api = Object.freeze({ request: this.request });
    window.ryzobeeLink = api;
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName());
    if (this.channel) this.channel.onmessage = async ({ data }: MessageEvent<unknown>) => {
      // Only requests for this page or pre-initialization discovery pings are routed here.
      if (!object(data) || !('method' in data)) return;
      const meta = object(data.params) && object(data.params._meta) ? data.params._meta[ROUTE_META] : null;
      if (!object(meta) || typeof meta.clientId !== 'string' || (meta.sessionId !== this.owner.sessionId && !(data.method === 'ping' && meta.sessionId === undefined))) return;
      const response = await this.request(data);
      if (response) this.channel?.postMessage(response);
    };
    return () => {
      this.channel?.close(); this.channel = null;
      if (window.ryzobeeLink === api) delete window.ryzobeeLink;
      for (const peer of this.peers.values()) void peer.server.close();
      this.peers.clear(); this.owner.revoke('页面已关闭');
    };
  }
}
