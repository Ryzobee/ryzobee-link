import type { Page } from '@playwright/test';

export interface SerialRequest { op: string; action?: string; command?: string; name?: string; id: string }

/** A browser stream peer, not a mocked DeviceClient: the real framing/CAS code runs. */
export async function installSerial(page: Page, options: { failRun?: boolean; fileCount?: number } = {}) {
  await page.addInitScript(({ failRun, fileCount = 1 }) => {
    const encoder = new TextEncoder();
    const boot = 'e2e12345';
    const files = new Map([['welcome.lua', 'print("来自设备")']]);
    for (let index = 1; index < fileCount; index++) files.set('example_' + index + '.lua', 'print("来自设备")');
    const requests: Record<string, unknown>[] = [];
    Object.defineProperty(window, '__serialRequests', { value: requests });
    const hash = async (source: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(source))), value => value.toString(16).padStart(2, '0')).join('');
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const reply = (request: Record<string, unknown>, value: Record<string, unknown>) => {
      controller.enqueue(encoder.encode(`RYZOBEE_RPC ${JSON.stringify({ id: request.id, ok: true, ...value })}\n`));
    };
    const versioned = (request: Record<string, unknown>, value: Record<string, unknown>) => reply(request, { schema: 'ryz-script-store/1', boot_id: boot, ...value });
    let revision = 1;
    const port = {
      readable: new ReadableStream<Uint8Array>({ start: value => { controller = value; } }),
      writable: new WritableStream<Uint8Array>({ write: async bytes => {
        const request = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
        requests.push(request);
        const name = String(request.name ?? '');
        if (request.op === 'info') reply(request, { chip: 'ESP32-S3', firmware: 'link-e2e', protocol_version: 2, boot_id: boot, source_limit_bytes: 16384, job: null, recent_job: null });
        else if (request.op === 'get') {
          const source = files.get(name);
          if (source === undefined) reply(request, { ok: false, error: 'script not found' });
          else reply(request, { name, source, bytes: encoder.encode(source).length, sha256: await hash(source) });
        } else if (request.op === 'console') {
          if (String(request.command).startsWith('lua --run-async') && failRun) reply(request, { ok: false, error: 'Lua 启动失败：设备运行资源不足' });
          else reply(request, { output: 'started', job: { job_id: `${boot}-1`, name: String(request.command).split(' ').at(-1), state: 'running' } });
        } else if (request.op === 'scripts') {
          if (request.schema !== 'ryz-script-store/1' || request.boot_id !== boot) throw new Error('Client sent invalid scripts identity');
          if (request.action === 'catalog') {
            const entries = [...files].map(([name, source]) => ({ name, bytes: encoder.encode(source).length, protected: false }));
            const offset = Number(request.offset);
            const selected = entries.slice(offset, offset + Number(request.limit));
            versioned(request, { revision, offset, total: entries.length, count: selected.length, files: selected });
          } else if (request.action === 'status') {
            versioned(request, { ready: true, recovery_required: false, capacity_valid: true, total_bytes: 102400, used_bytes: 20480, revision });
          } else if (request.action === 'describe') {
            const source = files.get(name);
            if (source === undefined) reply(request, { ok: false, error: 'script not found' });
            else versioned(request, { name, bytes: encoder.encode(source).length, protected: false, sha256: await hash(source), created_at: null, modified_at: null });
          } else if (request.action === 'put') {
            const old = files.get(name);
            const previous = old === undefined ? '' : await hash(old);
            if (request.previous_sha256 !== previous) versioned(request, { ok: false, store_commit: 'not_committed', error: 'script changed' });
            else {
              const source = String(request.source);
              const sha256 = await hash(source);
              if (sha256 !== request.sha256) throw new Error('Client sent invalid source hash');
              files.set(name, source); revision++;
              versioned(request, { store_commit: 'committed', bytes: encoder.encode(source).length, sha256, revision });
            }
          } else if (request.action === 'remove') {
            files.delete(name); revision++;
            versioned(request, { store_commit: 'committed', revision });
          } else throw new Error(`Unhandled scripts action ${request.action}`);
        } else throw new Error(`Unhandled operation ${request.op}`);
      } }),
      open: async () => {}, close: async () => {}, setSignals: async () => {},
    };
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => port } });
  }, options);
}

export function serialRequests(page: Page): Promise<SerialRequest[]> {
  return page.evaluate(() => (window as unknown as { __serialRequests: SerialRequest[] }).__serialRequests);
}
