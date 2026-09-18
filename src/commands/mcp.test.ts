import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResultSchema, ListToolsResultSchema, type JSONRPCMessage, type RequestId } from '@modelcontextprotocol/sdk/types.js';
import { BrowserMcpServer } from './mcp';
import { CommandOwner, type CommandBackend, type OperationResult } from './owner';
import { MCP_VERSION, ROUTE_META, type McpResponse } from './protocol';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Only the external destination is replaced; SDK, protocol and owner are real. */
class Destination implements CommandBackend {
  committed: string[] = [];
  started = deferred();
  wait?: Promise<void>;
  output: OperationResult = { data: { saved: true } };
  identity = () => ({ connection: 'disconnected', boot: null, epoch: 0 });
  async execute(command: string, _args: Record<string, unknown>, guard: () => void) {
    this.started.resolve();
    await this.wait;
    guard();
    this.committed.push(command);
    return this.output;
  }
}

function toolResult(response: McpResponse | undefined) {
  if (!response || !('result' in response)) throw new Error(`Expected tool result: ${JSON.stringify(response)}`);
  return CallToolResultSchema.parse(response.result);
}

function fixture() {
  const destination = new Destination();
  const owner = new CommandOwner(destination);
  const server = new BrowserMcpServer(owner);
  const clientId = 'mcp-test';
  const route = { clientId, sessionId: owner.sessionId };
  const request = (id: RequestId | undefined, method: string, params: Record<string, unknown> = {}) => server.request({
    jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method,
    params: { ...params, _meta: { [ROUTE_META]: route } },
  });
  const call = (id: RequestId, name: string, args: Record<string, unknown> = {}) => request(id, 'tools/call', { name, arguments: args });
  const initialize = async (version: string = MCP_VERSION, ready = true) => {
    const response = await request('init', 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 'init', result: { protocolVersion: MCP_VERSION, capabilities: { tools: {} } } });
    if (ready) expect(await request(undefined, 'notifications/initialized')).toBeUndefined();
  };
  const approve = () => { owner.requestControl({ clientId }); owner.approve(); };
  return { destination, owner, server, request, call, initialize, approve, route };
}

describe('browser MCP protocol', () => {
  it('negotiates lifecycle, validates standard messages and publishes usable tool schemas', async () => {
    const { server, request, call, initialize, destination, owner, approve } = fixture();
    expect(await server.request('{bad')).toMatchObject({ jsonrpc: '2.0', error: { code: -32700 } });
    expect(await server.request({ requestId: 'old', command: 'workspace.list' })).toMatchObject({ error: { code: -32600 } });
    expect(await call('early', 'workspace.list')).toMatchObject({ error: { code: -32600 } });
    expect(await request('discovery', 'ping')).toMatchObject({ result: { _meta: { [ROUTE_META]: { initialized: false, owner: { control: 'none' } } } } });
    await initialize('2099-01-01', false);
    expect(await request('before-ready', 'tools/list')).toMatchObject({ error: { code: -32600 } });
    expect(await request(undefined, 'notifications/initialized')).toBeUndefined();
    expect(await request('ready-ping', 'ping')).toMatchObject({ result: { _meta: { [ROUTE_META]: { initialized: true } } } });
    expect(await request('second-init', 'initialize', { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1' } }))
      .toMatchObject({ error: { code: -32600 } });
    const listed = await request('list', 'tools/list');
    if (!listed || !('result' in listed)) throw new Error('Expected tools/list result');
    const { tools } = ListToolsResultSchema.parse(listed.result);
    expect(tools.some(tool => tool.name === 'help')).toBe(false);
    expect(tools.find(tool => tool.name === 'workspace.open')?.inputSchema).toEqual({
      type: 'object', properties: { name: { type: 'string' }, source: { type: 'string' } },
      required: ['name', 'source'], additionalProperties: false,
    });
    expect(tools.find(tool => tool.name === 'link.request_result')?.inputSchema).toMatchObject({
      type: 'object', required: ['requestId'], properties: { requestId: { type: ['string', 'integer'] } },
    });
    expect(await request(undefined, 'notifications/unknown')).toBeUndefined();
    expect(await request(undefined, 'notifications/cancelled', { requestId: 'not-active' })).toBeUndefined();
    expect(await request('unknown-method', 'not/a/method')).toMatchObject({ error: { code: -32601 } });
    expect(await call('unknown-tool', 'missing.tool')).toMatchObject({ error: { code: -32602 } });
    expect(await request('bad-call', 'tools/call', { name: 42 })).toMatchObject({ error: { code: -32602 } });
    expect(toolResult(await call('permission', 'workspace.list'))).toMatchObject({
      isError: true, structuredContent: { status: 'rejected', error: { code: 'NEEDS_APPROVAL' } },
    });
    expect(toolResult(await call('invalid-args', 'link.request_control', { label: 42 }))).toMatchObject({
      isError: true, structuredContent: { error: { code: 'INVALID_ARGUMENT' } },
    });
    // Task augmentation must not silently turn into an ordinary tool execution.
    expect(await request('task-control', 'tools/call', { name: 'link.request_control', task: { ttl: 60000 } }))
      .toMatchObject({ error: { code: -32602 } });
    expect(owner.hello().control).toBe('none');
    approve();
    expect(await request('task-write', 'tools/call', { name: 'device.run', arguments: { name: 'example.lua' }, task: { ttl: 60000 } }))
      .toMatchObject({ error: { code: -32602 } });
    expect(destination.committed).toEqual([]);
    expect(toolResult(await call('task-result', 'link.request_result', { requestId: 'task-write' })))
      .toMatchObject({ isError: true, structuredContent: { error: { code: 'NOT_SEEN' } } });
  });

  it('works with the unmodified official SDK Client over a routed JSON-RPC transport', async () => {
    const { owner, server, route, destination } = fixture();
    const wire: JSONRPCMessage[] = [];
    class BrowserTransport implements Transport {
      onmessage?: Transport['onmessage'];
      onclose?: () => void;
      onerror?: (error: Error) => void;
      async start() {}
      async close() { this.onclose?.(); }
      async send(message: JSONRPCMessage) {
        wire.push(message);
        if (!('method' in message)) throw new Error('Expected client request or notification');
        const response = await server.request({ ...message, params: { ...message.params, _meta: { ...message.params?._meta, [ROUTE_META]: route } } });
        if (response) this.onmessage?.(response);
      }
    }
    const client = new Client({ name: 'official-sdk-test', version: '1' });
    await client.connect(new BrowserTransport());
    try {
      expect(wire.slice(0, 2)).toMatchObject([
        { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: MCP_VERSION } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ]);
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain('device.upload');
      expect(await client.callTool({ name: 'workspace.list' })).toMatchObject({ isError: true });
      expect(await client.callTool({ name: 'link.request_control', arguments: { label: 'Official SDK' } }))
        .toMatchObject({ isError: false, structuredContent: { data: { control: 'pending' } } });
      expect(destination.committed).toEqual([]);
      owner.approve();
      const result = await client.callTool({ name: 'workspace.open', arguments: { name: 'example.lua', source: 'print(1)' } });
      expect(result).toMatchObject({ isError: false, structuredContent: { status: 'completed', data: { saved: true } } });
      expect(result.content).toContainEqual({ type: 'text', text: JSON.stringify(result.structuredContent) });
      await expect(client.callTool({ name: 'not-a-tool' })).rejects.toMatchObject({ code: -32602 });
      expect(destination.committed).toEqual(['workspace.open']);
      const ids = wire.flatMap(message => 'id' in message ? [message.id] : []);
      expect(new Set(ids).size).toBe(ids.length);
    } finally { await client.close(); }
  });

  it('recovers original request results with fresh IDs and never replays an ID, including while pending', async () => {
    const { destination, request, call, initialize, approve, owner } = fixture();
    await initialize();
    approve();
    const waiting = deferred();
    destination.wait = waiting.promise;
    destination.output = { accepted: true, data: { job: { job_id: 'job-1' } } };
    const first = call(7, 'device.run', { name: 'example.lua' });
    await destination.started.promise;
    expect(toolResult(await call('pending-query', 'link.request_result', { requestId: 7 })))
      .toMatchObject({ isError: false, structuredContent: { status: 'accepted', data: { pending: true } } });
    expect(await call(7, 'device.run', { name: 'example.lua' })).toMatchObject({ error: { code: -32600 } });
    waiting.resolve();
    const original = toolResult(await first);
    expect(toolResult(await call('recovery', 'link.request_result', { requestId: 7 }))).toEqual(original);
    expect(toolResult(await call('not-seen', 'link.request_result', { requestId: '7' })))
      .toMatchObject({ isError: true, structuredContent: { error: { code: 'NOT_SEEN' } } });
    expect(await call(7, 'device.run', { name: 'other.lua' })).toMatchObject({ error: { code: -32600 } });
    expect(destination.committed).toEqual(['device.run']);
    expect(toolResult(await call('control-read', 'link.control_status'))).toMatchObject({ isError: false });
    expect(toolResult(await call('control-result', 'link.request_result', { requestId: 'control-read' })))
      .toMatchObject({ isError: true, structuredContent: { error: { code: 'NOT_SEEN' } } });
    expect(toolResult(await call('query-result', 'link.request_result', { requestId: 'recovery' })))
      .toMatchObject({ isError: true, structuredContent: { error: { code: 'NOT_SEEN' } } });
    owner.revoke();
    expect(toolResult(await call('revoked', 'workspace.open', { name: 'blocked.lua', source: '' })))
      .toMatchObject({ isError: true, structuredContent: { error: { code: 'NEEDS_APPROVAL' } } });
    expect(await request('recovery', 'ping')).toMatchObject({ error: { code: -32600 } });
  });

  it('keeps repeated unscoped discovery outside the selected session request budget', async () => {
    const { server, route, request, call, initialize, approve } = fixture();
    await initialize();
    approve();
    // More discovery polls than the bounded per-session request budget must
    // still leave a long-lived idle page usable, without relaxing selected IDs.
    for (let index = 0; index < 5000; index++) {
      expect(await server.request({ jsonrpc: '2.0', id: `discovery-${index}`, method: 'ping',
        params: { _meta: { [ROUTE_META]: { clientId: route.clientId } } },
      })).toMatchObject({ result: { _meta: { [ROUTE_META]: { sessionId: route.sessionId, initialized: true } } } });
    }
    expect(toolResult(await call('after-discovery', 'workspace.list'))).toMatchObject({ isError: false });
    expect(await request('selected-ping', 'ping')).toHaveProperty('result');
    expect(await request('selected-ping', 'ping')).toMatchObject({ error: { code: -32600 } });
  });

  it('settles a cancelled pending request without replying or committing and keeps its result recoverable', async () => {
    const { destination, request, call, initialize, approve } = fixture();
    await initialize();
    approve();
    const waiting = deferred();
    destination.wait = waiting.promise;
    const pending = call('cancelled-write', 'device.run', { name: 'example.lua' });
    await destination.started.promise;
    expect(await request(undefined, 'notifications/cancelled', { requestId: 'cancelled-write', reason: 'User stopped the request' })).toBeUndefined();
    // The browser request must settle even while the external operation is
    // awaiting; no JSON-RPC response is emitted for the cancelled request.
    await expect(pending).resolves.toBeUndefined();
    expect(destination.committed).toEqual([]);
    waiting.resolve();
    let query = 0;
    await expect.poll(async () => toolResult(await call(`cancel-result-${query++}`, 'link.request_result', { requestId: 'cancelled-write' })).structuredContent)
      .toMatchObject({ status: 'rejected', error: { code: 'CANCELLED' } });
    expect(await call('cancelled-write', 'device.run', { name: 'example.lua' })).toMatchObject({ error: { code: -32600 } });
    expect(destination.committed).toEqual([]);
    expect(toolResult(await call('after-cancel', 'workspace.list'))).toMatchObject({ isError: false });
    expect(destination.committed).toEqual(['workspace.list']);
  });

  it('returns capture pixels as standard MCP image content and leaves structured data as metadata', async () => {
    const { destination, call, initialize, approve } = fixture();
    await initialize();
    approve();
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
    destination.output = { data: { runId: 'run-1', sourceName: 'example.lua', state: 'running', width: 1, height: 1, dataUrl: `data:image/png;base64,${png}` } };
    const result = toolResult(await call('capture', 'simulator.capture', { runId: 'run-1' }));
    expect(result.content).toContainEqual({ type: 'image', mimeType: 'image/png', data: png });
    expect(result.structuredContent).toEqual({ status: 'completed', data: { runId: 'run-1', sourceName: 'example.lua', state: 'running', width: 1, height: 1 } });
    expect(result.content).toContainEqual({ type: 'text', text: JSON.stringify(result.structuredContent) });
    expect(JSON.stringify(result.structuredContent)).not.toContain(png);
  });
});
