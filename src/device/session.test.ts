import { afterEach, describe, expect, it } from 'vitest';
import { AnsiDecoder, DeviceClient, STORE_SCHEMA, UnknownResultError, sourceHash } from './index';
import type { SerialPortLike } from './types';
import { logRows } from '../workspace/logs';

const encoder = new TextEncoder();
type Request = Record<string, unknown> & { id: string };
const info = { chip: 'ESP32-S3', firmware: '0.4.0', protocol_version: 2, boot_id: 'abcd1234', source_limit_bytes: 16384, job: null, recent_job: null };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

class Port implements SerialPortLike {
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  readonly requests: Request[] = [];
  readonly signals: unknown[] = [];
  readonly readable = new ReadableStream<Uint8Array>({ start: controller => { this.controller = controller; } });
  readonly writable = new WritableStream<Uint8Array>({ write: async bytes => {
    const request = JSON.parse(new TextDecoder().decode(bytes)) as Request;
    this.requests.push(request);
    if (request.op === 'info') this.reply(request, { ...info, ...this.boardInfo });
    else await this.onRequest?.(request);
  } });
  boardInfo: Record<string, unknown> = {};
  onRequest?: (request: Request) => void | Promise<void>;
  opened = false;
  closed = false;
  async open() { this.opened = true; }
  async close() { this.closed = true; }
  async setSignals(signals: unknown) { this.signals.push(signals); }
  send(text: string, split = false) {
    const bytes = encoder.encode(text);
    if (split) for (const byte of bytes) this.controller.enqueue(Uint8Array.of(byte));
    else this.controller.enqueue(bytes);
  }
  reply(request: Request, fields: Record<string, unknown>, split = false) {
    this.send(`RYZOBEE_RPC ${JSON.stringify({ id: request.id, ok: true, ...fields })}\n`, split);
  }
  versioned(request: Request, fields: Record<string, unknown>) {
    this.reply(request, { schema: STORE_SCHEMA, boot_id: info.boot_id, ...fields });
  }
  unplug() { this.controller.close(); }
}

const clients: DeviceClient[] = [];
async function connect(port = new Port(), timeout = 1000) {
  const client = new DeviceClient(timeout);
  clients.push(client);
  await client.connect(port);
  return { client, port };
}
afterEach(async () => { await Promise.all(clients.splice(0).map(client => client.disconnect())); });

describe('single-owner Web Serial session', () => {
  it('assembles fragmented UTF-8/RPC, preserves ANSI as safe text spans, and bounds log memory', async () => {
    const { client, port } = await connect();
    port.onRequest = request => port.reply(request, { output: '帮助：中文' }, true);
    await client.command('help');
    port.send('\x1b[31mE (12) 中文 <img src=x>\x1b[0m\n', true);
    const bytes = encoder.encode('你好');
    bytes.forEach((byte, seq) => {
      port.send(`RYZOBEE_EVENT ${JSON.stringify({ event: 'output', boot_id: info.boot_id, job_id: 'abcd1234-1', seq, data_b64: btoa(String.fromCharCode(byte)) })}\n`);
      if (seq === 0) port.send(`RYZOBEE_EVENT ${JSON.stringify({ event: 'job', boot_id: info.boot_id, job: { job_id: 'abcd1234-1', name: 'hello.lua', state: 'done' } })}\n`);
    });
    await tick();
    const logs = client.getSnapshot().logs;
    expect(logs.some(row => row.text === '帮助：中文')).toBe(true);
    const ansi = logs.find(row => row.text.includes('<img'))!;
    expect(ansi.spans).toEqual([{ text: 'E (12) 中文 <img src=x>', color: '#ff6c75' }]);
    expect(logs.filter(row => row.kind === 'output').map(row => row.text).join('')).toBe('你好');
    expect(logs.some(row => row.text.includes('丢帧'))).toBe(false);
    port.send('RYZOBEE_RPC {broken}\n');
    port.send(`${'x'.repeat(65537)}\nrecovered\n`);
    await tick();
    expect(client.getSnapshot().logs.at(-1)?.text).toBe('recovered');
    for (let i = 0; i < 1200; i++) client.message(`${i}: ${'a'.repeat(200)}`);
    expect(client.getSnapshot().logs.length).toBeLessThanOrEqual(1000);
    expect(client.getSnapshot().logs.reduce((sum, row) => sum + row.text.length, 0)).toBeLessThanOrEqual(160000);
    const splitAnsi = new AnsiDecoder();
    expect(splitAnsi.decode('\x1b[3')).toEqual([]);
    expect(splitAnsi.decode('2mgreen\x1b[0m')).toEqual([{ text: 'green', color: '#91c785' }]);
    const visual = logRows([{ id: '1', time: 0, source: 'serial', level: 'error', message: 'stopped\n原因', spans: [{ text: 'stopped\n原因', color: '#ff6c75' }] }]);
    expect(visual.map(row => row.message)).toEqual(['stopped', '原因']);
    expect(visual[1].spans?.[0].color).toBe('#ff6c75');
    expect(logRows([{ id: '2', time: 0, source: 'serial', level: 'info', message: '\n'.repeat(8192) }], 20)).toHaveLength(20);
  });

  it('uses revision-bound catalog/status, verified get, CAS writes, and Console execution without simulator tickets', async () => {
    const { client, port } = await connect();
    const source = 'print("中文")';
    const hash = await sourceHash(source);
    const files = Array.from({ length: 17 }, (_, index) => ({ name: `file_${index}.lua`, bytes: 8, protected: index === 0 }));
    port.onRequest = request => {
      if (request.op === 'get') port.reply(request, { name: request.name, source, sha256: hash, bytes: encoder.encode(source).length }, true);
      else if (request.op === 'console') port.reply(request, { output: 'started', job: { job_id: 'abcd1234-1', name: 'hello.lua', state: 'running' } });
      else if (request.action === 'catalog') {
        expect(request.schema).toBe(STORE_SCHEMA);
        expect(request.boot_id).toBe(info.boot_id);
        const offset = Number(request.offset);
        expect(request.revision).toBe(offset ? 7 : 0);
        const page = files.slice(offset, offset + 16);
        port.versioned(request, { revision: 7, offset, total: files.length, count: page.length, files: page });
      } else if (request.action === 'status') {
        port.versioned(request, { ready: true, recovery_required: false, capacity_valid: false, revision: 7, total_bytes: null, used_bytes: null });
      } else if (request.action === 'describe') {
        port.versioned(request, { name: request.name, bytes: encoder.encode(source).length, protected: false, sha256: hash, created_at: null, modified_at: null });
      } else if (request.action === 'put') {
        expect(request.previous_sha256).toBe('');
        expect(request.sha256).toBe(hash);
        port.versioned(request, { store_commit: 'committed', bytes: encoder.encode(source).length, sha256: hash });
      } else if (request.action === 'remove') {
        expect(request.previous_sha256).toBe(hash);
        port.versioned(request, { store_commit: 'committed' });
      }
    };
    expect(await client.list()).toEqual(files);
    expect((await client.storage()).total_bytes).toBeNull();
    expect(await client.get('hello.lua')).toEqual({ name: 'hello.lua', source, sha256: hash, bytes: encoder.encode(source).length });
    expect((await client.describe('hello.lua')).sha256).toBe(hash);
    await expect(client.upload('file_0.lua', source)).rejects.toThrow('保护');
    await expect(client.upload('../hello.lua', source)).rejects.toThrow('文件名');
    await expect(client.remove('hello.lua', '')).rejects.toThrow('版本');
    expect(await client.upload('hello.lua', source)).toBe(hash);
    await client.run('hello.lua');
    await client.stop('abcd1234-1');
    await client.remove('hello.lua', hash);
    expect(port.requests.filter(request => request.op === 'console').map(request => request.command))
      .toEqual(['lua --run-async --path hello.lua', 'lua --stop abcd1234-1']);
    expect(port.requests.some(request => 'ticket' in request || 'simulation' in request)).toBe(false);
    expect(port.signals).toEqual([{ requestToSend: false }, { dataTerminalReady: false }]);
    port.onRequest = request => port.reply(request, { ok: false, error: 'busy: runtime owner has an active job' });
    await expect(client.get('hello.lua')).rejects.toThrow('先点击文件区的“停止”');
  });

  it('marks a sent mutation unknown on unplug, never retries it, and does not automatically run on reconnect', async () => {
    const { client, port } = await connect();
    const run = client.run('hello.lua');
    const outcome = expect(run).rejects.toBeInstanceOf(UnknownResultError);
    await tick();
    port.unplug();
    await outcome;
    await tick();
    expect(client.getSnapshot().connection).toBe('disconnected');
    expect(client.getSnapshot().unknown).toEqual(['lua --run-async --path hello.lua']);
    expect(port.requests.filter(request => request.op === 'console')).toHaveLength(1);
    const second = new Port();
    second.boardInfo = { boot_id: '1234abcd' };
    await client.connect(second);
    expect(client.getSnapshot().info?.boot_id).toBe('1234abcd');
    expect(second.requests.map(request => request.op)).toEqual(['info']);
    expect(client.getSnapshot().jobs).toEqual([]);
  });

  it('distinguishes an opened UART from a recognized device and rejects commands on an unknown device', async () => {
    const port = new Port();
    port.boardInfo = { protocol_version: 1 };
    const client = new DeviceClient(50);
    clients.push(client);
    await expect(client.connect(port)).rejects.toThrow('协议 v2');
    expect(client.getSnapshot().connection).toBe('serial-open');
    expect(client.getSnapshot().info).toBeNull();
    expect(client.getSnapshot().error).toContain('尚未识别');
    await expect(client.run('hello.lua')).rejects.toThrow('识别');
    port.send('plain serial still works\n');
    await tick();
    expect(client.getSnapshot().logs.at(-1)?.text).toBe('plain serial still works');
  });

  it('rejects bad checksums and inconsistent catalog pages; timed-out writes stay unknown, without retries', async () => {
    const { client, port } = await connect(new Port(), 20);
    port.onRequest = request => {
      if (request.op === 'get') port.reply(request, { name: request.name, source: 'hello', sha256: '0'.repeat(64), bytes: 5 });
      else if (request.action === 'catalog') port.versioned(request, { revision: 1, offset: 0, total: 1, count: 0, files: [] });
    };
    await expect(client.get('hello.lua')).rejects.toThrow('完整性');
    await expect(client.list()).rejects.toThrow('不完整');
    await expect(client.upload('hello.lua', 'print(1)')).rejects.toBeInstanceOf(UnknownResultError);
    expect(port.requests.filter(request => request.action === 'put')).toHaveLength(1);
    const writes = port.requests.length;
    await tick();
    expect(port.requests).toHaveLength(writes);
    expect(client.getSnapshot().unknown).toContain('put hello.lua');
  });
});
