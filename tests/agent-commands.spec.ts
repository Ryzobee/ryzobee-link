import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpResponse } from '../src/commands/protocol';
import type {} from '../src/agent/client';
import { installSerial, serialRequests } from './fake-serial';

type DocumentResult = { id: string; name: string; source: string; sha256: string; persisted?: boolean };
type SimulatorStatus = { runId: string; state: string; frameRevision: number; sourceName: string };
function result(reply: McpResponse | undefined) {
  if (!reply || !('result' in reply)) throw new Error(`Expected MCP result: ${JSON.stringify(reply)}`);
  return CallToolResultSchema.parse(reply.result);
}
function data<T>(reply: McpResponse | undefined): T {
  const tool = result(reply);
  expect(tool.isError, JSON.stringify(reply)).toBe(false);
  return tool.structuredContent!.data as T;
}
async function command(agent: Page, sessionId: string, name: string, args: Record<string, unknown> = {}, requestId: string = randomUUID()) {
  return agent.evaluate(({ sessionId, message }) => window.ryzobeeLinkAgent!.request(sessionId, message), {
    sessionId, message: { jsonrpc: '2.0' as const, id: requestId, method: 'tools/call', params: { name, arguments: args } },
  });
}
async function pages(main: Page, context: BrowserContext, fragment = '') {
  await main.goto('/');
  await expect(main.locator('.lua-editor .monaco-editor')).toBeVisible();
  const agent = await context.newPage();
  await agent.goto('/agent.html' + fragment);
  await expect(agent.getByRole('button', { name: '申请授权', exact: true })).toBeEnabled();
  const sessionId = await agent.getByRole('combobox', { name: 'LINK 会话', exact: true }).inputValue();
  expect(sessionId).not.toBe('');
  await agent.evaluate(sessionId => window.ryzobeeLinkAgent!.connect(sessionId), sessionId);
  return { agent, sessionId };
}
async function approve(main: Page, agent: Page, screenshot?: string) {
  await agent.getByRole('button', { name: '申请授权', exact: true }).click();
  const approval = main.getByRole('dialog', { name: '允许 AI 控制本次会话？', exact: true });
  await expect(approval).toBeVisible();
  if (screenshot) await main.screenshot({ path: screenshot });
  await approval.getByRole('button', { name: '允许本次控制', exact: true }).click();
  await expect(main.getByRole('button', { name: '结束 AI 控制', exact: true })).toBeVisible();
  await expect(agent.locator('#session-status')).toContainText('已授权此 MCP 客户端');
}

test('agent JSON and BroadcastChannel share the editor and real simulator, while URLs and revoked control cannot execute', async ({ page, context }) => {
  const prefill = { jsonrpc: '2.0', id: 'url-must-not-run', method: 'tools/call', params: { name: 'workspace.open', arguments: { name: 'url.lua', source: 'print("unexpected")' } } };
  const { agent, sessionId } = await pages(page, context, '#command=' + encodeURIComponent(JSON.stringify(prefill)));
  await expect(agent.getByRole('textbox', { name: 'MCP JSON-RPC', exact: true })).toHaveValue(JSON.stringify(prefill));
  expect(result(await command(agent, sessionId, 'workspace.list'))).toMatchObject({ isError: true, structuredContent: { error: { code: 'NEEDS_APPROVAL' } } });
  await approve(page, agent, '.cache/agent-review/control-approval.png');
  const unseen = await command(agent, sessionId, 'link.request_result', { requestId: prefill.id });
  expect(result(unseen)).toMatchObject({ isError: true, structuredContent: { error: { code: 'NOT_SEEN' } } });
  await expect(page.getByRole('tablist', { name: '打开的 Lua 文件' }).getByRole('tab')).toHaveCount(1);
  const demo = data<DocumentResult>(await command(agent, sessionId, 'workspace.read'));

  const open = { jsonrpc: '2.0', id: 'json-open', method: 'tools/call', params: { name: 'workspace.open', arguments: { name: 'agent_edit.lua', source: 'print("opened through command")\n' } } };
  await agent.getByRole('textbox', { name: 'MCP JSON-RPC', exact: true }).fill(JSON.stringify(open));
  await agent.getByRole('button', { name: '发送 MCP 请求', exact: true }).click();
  const output = agent.locator('#command-result');
  await expect(output).toContainText('"id": "json-open"');
  const opened = data<DocumentResult>(JSON.parse(await output.innerText()));
  expect(opened.persisted).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Lua 文件名', exact: true })).toHaveValue('agent_edit.lua');
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('opened through command');
  const source = 'print("updated from agent")\n';
  const edited = data<DocumentResult>(await command(agent, sessionId, 'workspace.update', { documentId: opened.id, expectedSha256: opened.sha256, source }));
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('updated from agent');
  expect(data<DocumentResult>(await command(agent, sessionId, 'workspace.read', { documentId: opened.id })).source).toBe(source);
  expect(edited.sha256).not.toBe(opened.sha256);
  expect(result(await command(agent, sessionId, 'workspace.update', { documentId: opened.id, expectedSha256: opened.sha256, source: 'stale edit' })))
    .toMatchObject({ isError: true, structuredContent: { error: { code: 'SOURCE_CHANGED' } } });

  const accepted = await command(agent, sessionId, 'simulator.run', { documentId: demo.id, expectedSha256: demo.sha256 });
  expect(result(accepted).structuredContent?.status).toBe('accepted');
  const run = data<SimulatorStatus>(accepted);
  await expect.poll(async () => data<SimulatorStatus>(await command(agent, sessionId, 'simulator.status')).state).toBe('running');
  await expect.poll(async () => data<SimulatorStatus>(await command(agent, sessionId, 'simulator.status')).frameRevision).toBeGreaterThan(0);
  await expect(page.locator('.simulator-state')).toHaveText('运行中');
  await page.screenshot({ path: '.cache/agent-review/control-simulator.png' });
  await agent.screenshot({ path: '.cache/agent-review/command-page.png', fullPage: true });
  type Capture = { runId: string; sourceName: string; width: number; height: number };
  const captured = await command(agent, sessionId, 'simulator.capture', { runId: run.runId });
  const frame = data<Capture>(captured);
  expect(frame).toMatchObject({ runId: run.runId, sourceName: demo.name, width: 240, height: 240 });
  expect(frame).not.toHaveProperty('dataUrl');
  const image = result(captured).content.find(block => block.type === 'image');
  if (!image || image.type !== 'image') throw new Error('Missing standard MCP image content');
  expect(image.mimeType).toBe('image/png');
  const png = Buffer.from(image.data, 'base64');
  expect(png.readUInt32BE(16)).toBe(240);
  expect(png.readUInt32BE(20)).toBe(240);
  data(await command(agent, sessionId, 'simulator.pointer', { runId: run.runId, x: 120, y: 180, pressed: true }));
  // Keep the press through at least one real Lua/LVGL input polling cycle.
  await page.waitForTimeout(70);
  data(await command(agent, sessionId, 'simulator.pointer', { runId: run.runId, x: 120, y: 180, pressed: false }));
  await expect.poll(async () => {
    const logs = data<{ local: { message: string; runId?: string }[] }>(await command(agent, sessionId, 'logs.read', { runId: run.runId }));
    return logs.local.some(row => row.runId === run.runId && /count\s+1/.test(row.message));
  }).toBe(true);
  await expect.poll(async () => result(await command(agent, sessionId, 'simulator.capture', { runId: run.runId })).content.find(block => block.type === 'image')?.data).not.toBe(image.data);
  data(await command(agent, sessionId, 'simulator.stop', { runId: run.runId }));
  await expect(page.locator('.simulator-state')).toHaveText('未运行');
  await page.getByRole('button', { name: '结束 AI 控制', exact: true }).click();
  expect(result(await command(agent, sessionId, 'workspace.open', { name: 'denied.lua', source: 'print(1)' })))
    .toMatchObject({ isError: true, structuredContent: { error: { code: 'NEEDS_APPROVAL' } } });
  await expect(page.getByRole('tablist', { name: '打开的 Lua 文件' }).getByRole('tab')).toHaveCount(2);
});

test('agent requests a user serial gesture, uploads without simulation, and duplicate run IDs never rerun the device', async ({ page, context }) => {
  await installSerial(page);
  const { agent, sessionId } = await pages(page, context);
  await approve(page, agent);
  expect(result(await command(agent, sessionId, 'device.connect'))).toMatchObject({ isError: false, structuredContent: { status: 'accepted', data: { needsUserGesture: true } } });
  const connect = page.getByRole('dialog', { name: 'AI 请求连接设备', exact: true });
  await expect(connect).toBeVisible();
  expect(await serialRequests(page)).toEqual([]);
  await connect.getByRole('button', { name: '连接设备', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('已连接');
  await expect(connect).not.toBeVisible();
  const draft = data<DocumentResult>(await command(agent, sessionId, 'workspace.open', { name: 'agent_device.lua', source: 'print("agent device")\n' }));
  const before = data<SimulatorStatus>(await command(agent, sessionId, 'simulator.status'));
  expect(before).toMatchObject({ state: 'idle', runId: null });
  expect(result(await command(agent, sessionId, 'device.upload', { documentId: draft.id, expectedSha256: draft.sha256, previousSha256: '' })))
    .toMatchObject({ isError: false, structuredContent: { status: 'completed', data: { state: 'committed', name: draft.name, sha256: draft.sha256 } } });
  expect((await serialRequests(page)).filter(request => request.action === 'put')).toHaveLength(1);
  expect((await serialRequests(page)).filter(request => request.op === 'console')).toHaveLength(0);
  expect(data<SimulatorStatus>(await command(agent, sessionId, 'simulator.status')).runId).toBeNull();

  const runId = 'run-device-once';
  const started = await command(agent, sessionId, 'device.run', { name: draft.name }, runId);
  expect(result(started).structuredContent?.status).toBe('accepted');
  type Job = { job_id: string; name: string; state: string };
  const job = data<{ job: Job }>(started).job;
  // MCP forbids reusing an RPC id; query by the original id with a fresh RPC id.
  expect(await command(agent, sessionId, 'device.run', { name: draft.name }, runId)).toMatchObject({ error: { code: -32600 } });
  expect(result(await command(agent, sessionId, 'link.request_result', { requestId: runId }))).toEqual(result(started));
  expect((await serialRequests(page)).filter(request => request.command === 'lua --run-async --path agent_device.lua')).toHaveLength(1);
  expect(data<{ jobs: Job[] }>(await command(agent, sessionId, 'device.jobs')).jobs)
    .toContainEqual(expect.objectContaining({ job_id: job.job_id, name: draft.name, state: 'running' }));
  await expect(page.locator('.device-job')).toContainText(draft.name);
  expect(result(await command(agent, sessionId, 'device.stop', { jobId: job.job_id }))).toMatchObject({ isError: false, structuredContent: { status: 'accepted' } });
  expect(data<{ jobs: Job[] }>(await command(agent, sessionId, 'device.jobs')).jobs)
    .toContainEqual(expect.objectContaining({ job_id: job.job_id, state: 'stopped' }));
  expect((await serialRequests(page)).filter(request => request.command === `lua --stop ${job.job_id}`)).toHaveLength(1);
  await expect(page.locator('.device-job')).not.toBeVisible();
});
