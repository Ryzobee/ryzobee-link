import type { JSONRPCResponse } from '@modelcontextprotocol/sdk/types.js';
import { AgentClient, McpResponseError, TransportUnknownError, isRecord, ownerOf, parseMessage, readSession, writeSession,
  type AgentInterface, type ClientMessage, type RequestId } from './client';
import type { OwnerSummary } from '../commands/protocol';
import '../theme.css';
import './style.css';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sessionSelect = element<HTMLSelectElement>('agent-session');
const sessionStatus = element<HTMLParagraphElement>('session-status');
const discoverButton = element<HTMLButtonElement>('discover');
const controlButton = element<HTMLButtonElement>('request-control');
const commandForm = element<HTMLFormElement>('command-form');
const commandInput = element<HTMLTextAreaElement>('command-json');
const submitButton = element<HTMLButtonElement>('submit-command');
const queryButton = element<HTMLButtonElement>('query-result');
const resultOutput = element<HTMLPreElement>('command-result');
const resultStatus = element<HTMLParagraphElement>('result-status');
const resultTarget = element<HTMLParagraphElement>('result-target');

const client = new AgentClient();
let owners: OwnerSummary[] = [];
let selectedSessionId = readSession('sessionId') || '';
let discovering: Promise<OwnerSummary[]> | null = null;
let busy = false;
let lastRequest: { sessionId: string; id: RequestId } | null = null;
try {
  const saved: unknown = JSON.parse(readSession('lastMcpRequest') || 'null');
  if (isRecord(saved) && typeof saved.sessionId === 'string'
    && (typeof saved.id === 'string' || typeof saved.id === 'number' && Number.isSafeInteger(saved.id))) {
    lastRequest = { sessionId: saved.sessionId, id: saved.id };
  }
} catch { /* An invalid saved request does not prevent discovery. */ }

commandInput.value = JSON.stringify({ jsonrpc: '2.0', id: 'tools-1', method: 'tools/list', params: {} }, null, 2);
if (location.hash.length > 1) {
  // A fragment only prefills text; it never dispatches its contents.
  try {
    const fragment = location.hash.slice(1);
    commandInput.value = fragment.startsWith('command=')
      ? new URLSearchParams(fragment).get('command') || '' : decodeURIComponent(fragment);
  } catch { commandInput.value = location.hash.slice(1); }
}

function currentOwner() { return owners.find(owner => owner.sessionId === selectedSessionId); }
function rememberRequest(sessionId: string, message: ClientMessage) {
  if (!('id' in message) || message.method !== 'tools/call'
    || ['link.request_result', 'link.request_control', 'link.control_status'].includes(String(message.params?.name))) return;
  lastRequest = { sessionId, id: message.id };
  writeSession('lastMcpRequest', JSON.stringify(lastRequest));
  renderActions();
}
function renderActions() {
  const owner = currentOwner(), ownControl = !!owner && owner.clientId === client.clientId;
  controlButton.disabled = busy || !owner || (ownControl && owner.control !== 'none');
  controlButton.textContent = ownControl && owner?.control === 'pending' ? '等待主页面授权'
    : ownControl && owner?.control === 'granted' ? '已获授权' : '申请授权';
  submitButton.disabled = busy || !owner;
  queryButton.disabled = busy || !lastRequest;
  commandForm.setAttribute('aria-busy', String(busy));
  resultTarget.textContent = lastRequest ? `原请求 id: ${JSON.stringify(lastRequest.id)} · 会话: ${lastRequest.sessionId}` : '';
}
function renderSessions() {
  sessionSelect.replaceChildren(new Option(owners.length > 1 ? '请选择 LINK 会话' : '尚未选择会话', ''));
  if (selectedSessionId && !currentOwner()) sessionSelect.append(new Option(`会话已离线 · ${selectedSessionId}`, selectedSessionId));
  for (const owner of owners) sessionSelect.append(new Option(`${owner.title} · ${owner.connection} · ${owner.sessionId}`, owner.sessionId));
  sessionSelect.value = selectedSessionId;
  const owner = currentOwner();
  if (!owners.length) sessionStatus.textContent = '未发现 LINK 主页面，请在同一浏览器中打开同源主页面。';
  else if (!owner) sessionStatus.textContent = selectedSessionId ? '所选会话暂无响应，请确认主页面仍然打开。' : '发现多个会话，请先选择目标。';
  else if (owner.clientId === client.clientId && owner.control === 'granted') sessionStatus.textContent = `${owner.connection} · 已授权此 MCP 客户端`;
  else if (owner.clientId === client.clientId && owner.control === 'pending') sessionStatus.textContent = '授权申请已发送，请在 LINK 主页面确认。';
  else if (owner.control !== 'none') sessionStatus.textContent = `${owner.connection} · 另一客户端正在申请或持有授权`;
  else sessionStatus.textContent = `${owner.connection} · 尚未授权`;
  renderActions();
}
async function discover(): Promise<OwnerSummary[]> {
  if (discovering) return discovering;
  discoverButton.disabled = true;
  discovering = client.discover().then(found => {
    owners = found;
    if (!selectedSessionId && owners.length === 1) {
      selectedSessionId = owners[0].sessionId;
      writeSession('sessionId', selectedSessionId);
    }
    renderSessions();
    return owners;
  }).catch(error => {
    sessionStatus.textContent = error instanceof Error ? error.message : String(error);
    throw error;
  }).finally(() => { discovering = null; discoverButton.disabled = false; });
  return discovering;
}
function showReply(response: JSONRPCResponse | undefined) {
  if (!response) {
    resultOutput.textContent = '—';
    resultStatus.textContent = 'MCP 通知已发送；通知没有响应。';
    resultStatus.dataset.status = '';
    return;
  }
  resultOutput.textContent = JSON.stringify(response, null, 2);
  const owner = ownerOf(response);
  if (owner) { owners = owners.filter(item => item.sessionId !== owner.sessionId).concat(owner); renderSessions(); }
  if ('error' in response) {
    resultStatus.textContent = `JSON-RPC 错误 ${response.error.code}：${response.error.message}`;
    resultStatus.dataset.status = 'error';
    return;
  }
  const result = response.result, structured = isRecord(result.structuredContent) ? result.structuredContent : null;
  resultStatus.dataset.status = structured?.status === 'unknown' ? 'warning' : result.isError ? 'error' : 'success';
  resultStatus.textContent = structured?.status === 'unknown' ? '工具结果未知。请查询原请求 id 和实际状态，不要重发。'
    : result.isError ? 'MCP 工具返回错误，请查看响应。'
      : structured?.status === 'accepted' ? '操作已受理；请调用状态工具确认运行结果。' : '已收到 MCP 响应';
}
function showError(error: unknown) {
  if (error instanceof McpResponseError) {
    showReply(error.response);
    resultStatus.textContent = error.message;
    resultStatus.dataset.status = 'error';
    return;
  }
  // Local transport/parse failures are not counterfeit responses from the server.
  resultOutput.textContent = '—';
  resultStatus.textContent = `本地错误：${error instanceof Error ? error.message : String(error)}`;
  resultStatus.dataset.status = error instanceof TransportUnknownError ? 'warning' : 'error';
}
async function run<T>(operation: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('已有请求正在处理。');
  busy = true;
  renderActions();
  try { return await operation(); }
  finally { busy = false; renderActions(); }
}
async function send(sessionId: string, message: ClientMessage, prepare: boolean) {
  return run(async () => {
    if (prepare && message.method !== 'initialize' && !message.method.startsWith('notifications/')) await client.connect(sessionId);
    return request(sessionId, message);
  });
}
async function request(sessionId: string, message: ClientMessage) {
  rememberRequest(sessionId, message);
  resultStatus.textContent = '等待 MCP 响应…';
  resultStatus.dataset.status = '';
  const response = await client.request(sessionId, message);
  showReply(response);
  return response;
}
const api: AgentInterface = {
  clientId: client.clientId,
  discover,
  connect: sessionId => run(async () => { const response = await client.connect(sessionId); showReply(response); return response; }),
  // Raw MCP callers may send cancellation notifications while a request waits.
  request,
};
window.ryzobeeLinkAgent = api;

sessionSelect.addEventListener('change', () => { selectedSessionId = sessionSelect.value; writeSession('sessionId', selectedSessionId); renderSessions(); });
discoverButton.addEventListener('click', () => { void discover().catch(() => {}); });
controlButton.addEventListener('click', () => {
  void send(selectedSessionId, { jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call',
    params: { name: 'link.request_control', arguments: { label: 'LINK MCP 命令页' } } }, true).catch(showError);
});
commandForm.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const message = parseMessage(commandInput.value);
    if (!currentOwner()) throw new Error('请先选择可用的 LINK 会话。');
    void send(selectedSessionId, message, true).catch(showError);
  } catch (error) { showError(error); }
});
queryButton.addEventListener('click', () => {
  if (lastRequest) void send(lastRequest.sessionId, { jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call',
    params: { name: 'link.request_result', arguments: { requestId: lastRequest.id } } }, true).catch(showError);
});

renderActions();
void discover().catch(() => {});
setInterval(() => { void discover().catch(() => {}); }, 3000);
window.addEventListener('focus', () => { void discover().catch(() => {}); });
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(error => console.warn('离线缓存未启用', error));
  });
}
