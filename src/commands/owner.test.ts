import { describe, expect, it } from 'vitest';
import { CommandOwner, type CommandBackend, type OperationResult } from './owner';
import type { CommandRequest } from './protocol';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** A controllable command destination; the real owner checks every request. */
class Destination implements CommandBackend {
  device = { connection: 'disconnected', boot: null as string | null, epoch: 0 };
  committed: { command: string; args: Record<string, unknown> }[] = [];
  started = deferred();
  wait?: Promise<void>;
  identity = () => this.device;
  async execute(command: string, args: Record<string, unknown>, guard: () => void): Promise<OperationResult> {
    this.started.resolve();
    await this.wait;
    guard();
    this.committed.push({ command, args });
    return { data: { mutation: this.committed.length } };
  }
}

function fixture() {
  const destination = new Destination();
  const owner = new CommandOwner(destination);
  const clientId = 'test-agent';
  const request = (requestId: string, args: Record<string, unknown> = {}): CommandRequest => ({
    version: 1, sessionId: owner.sessionId, clientId, requestId, command: 'device.upload', args,
  });
  const approve = () => { owner.requestControl({ clientId, label: 'Test Agent' }); owner.approve(); };
  return { destination, owner, request, approve, clientId };
}

describe('human-approved command owner', () => {
  it('rejects before approval, commits concurrent duplicate requests once, and rejects changed arguments', async () => {
    const { destination, owner, request, approve, clientId } = fixture();
    const input = request('upload-1', { name: 'hello.lua', source: 'print(1)' });
    expect(await owner.execute(input)).toMatchObject({ ok: false, error: { code: 'NEEDS_APPROVAL' } });
    owner.requestControl({ clientId });
    expect(await owner.execute(input)).toMatchObject({ ok: false, error: { code: 'NEEDS_APPROVAL' } });
    expect(destination.committed).toEqual([]);
    approve();
    const pending = deferred();
    destination.wait = pending.promise;
    const first = owner.execute(input);
    const duplicate = owner.execute(request('upload-1', { source: 'print(1)', name: 'hello.lua' }));
    await destination.started.promise;
    expect(owner.result(input)).toMatchObject({ ok: true, status: 'accepted', data: { pending: true } });
    expect(await owner.execute(request('upload-1', { name: 'hello.lua', source: 'print(2)' })))
      .toMatchObject({ ok: false, error: { code: 'REQUEST_CONFLICT' } });
    pending.resolve();
    const [result, repeated] = await Promise.all([first, duplicate]);
    expect(result).toMatchObject({ ok: true, status: 'completed', data: { mutation: 1 } });
    expect(repeated).toEqual(result);
    expect(owner.result(input)).toEqual(result);
    expect(await owner.execute(input)).toEqual(result);
    expect(destination.committed).toEqual([{ command: 'device.upload', args: { name: 'hello.lua', source: 'print(1)' } }]);
  });

  it('blocks expired requests and revocation during an await even if the same client is approved again', async () => {
    const { destination, owner, request, approve } = fixture();
    approve();
    expect(await owner.execute({ ...request('expired'), expiresAt: Date.now() - 1 }))
      .toMatchObject({ ok: false, error: { code: 'REQUEST_EXPIRED' } });
    expect(destination.committed).toEqual([]);
    const pending = deferred();
    destination.wait = pending.promise;
    const result = owner.execute(request('waiting-write'));
    await destination.started.promise;
    owner.revoke();
    approve();
    pending.resolve();
    expect(await result).toMatchObject({ ok: false, error: { code: 'CONTROL_REVOKED' } });
    expect(destination.committed).toEqual([]);
  });

  it('binds the first connected device and invalidates control after boot, connection epoch, or disconnect changes', async () => {
    const { destination, owner, request, approve } = fixture();
    approve();
    destination.device = { connection: 'ready', boot: 'boot-a', epoch: 1 };
    owner.checkIdentity();
    expect(owner.hello().control).toBe('granted');
    for (const identity of [
      { connection: 'ready', boot: 'boot-b', epoch: 1 },
      { connection: 'ready', boot: 'boot-b', epoch: 2 },
      { connection: 'disconnected', boot: null, epoch: 3 },
    ]) {
      destination.device = identity;
      expect(owner.hello().control).toBe('none');
      expect(await owner.execute(request(`changed-${identity.epoch}-${identity.boot}`)))
        .toMatchObject({ ok: false, error: { code: 'NEEDS_APPROVAL' } });
      approve();
    }
    expect(destination.committed).toEqual([]);
  });

  it('keeps request tombstones after response eviction so an old mutation is never replayed', async () => {
    const { destination, owner, request, approve } = fixture();
    approve();
    const first = request('first-mutation');
    expect(await owner.execute(first)).toMatchObject({ ok: true, data: { mutation: 1 } });
    for (let index = 0; index < 80; index++) expect((await owner.execute(request(`later-${index}`))).ok).toBe(true);
    expect(owner.result(first)).toMatchObject({ ok: false, error: { code: 'RESULT_EXPIRED' } });
    expect(await owner.execute(first)).toMatchObject({ ok: false, error: { code: 'RESULT_EXPIRED' } });
    expect(await owner.execute(request('first-mutation', { changed: true })))
      .toMatchObject({ ok: false, error: { code: 'REQUEST_CONFLICT' } });
    expect(destination.committed).toHaveLength(81);
  });
});
