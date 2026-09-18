import { AgentClient, parseCommand, readSession, writeSession, type AgentInterface } from './client';
import { PROTOCOL_VERSION, type CommandReply, type OwnerSummary } from '../commands/protocol';
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
let lastRequest: { sessionId: string; requestId: string } | null = null;
try {
  const saved: unknown = JSON.parse(readSession('lastRequest') || 'null');
  if (saved && typeof saved === 'object' && 'sessionId' in saved && typeof saved.sessionId === 'string'
    && 'requestId' in saved && typeof saved.requestId === 'string') lastRequest = { sessionId: saved.sessionId, requestId: saved.requestId };
} catch { /* A missing or invalid saved request does not prevent discovery. */ }

commandInput.value = JSON.stringify({ requestId: 'demo-1', command: 'link.status', args: {} }, null, 2);
if (location.hash.length > 1) {
  // Fragments are text input only: opening a URL never dispatches a command.
  try {
    const fragment = location.hash.slice(1);
    commandInput.value = fragment.startsWith('command=')
      ? new URLSearchParams(fragment).get('command') || '' : decodeURIComponent(fragment);
  } catch {
    commandInput.value = location.hash.slice(1);
  }
}

function currentOwner() { return owners.find(owner => owner.sessionId === selectedSessionId); }
function rememberRequest(input: { sessionId: string; requestId: string }) {
  lastRequest = { sessionId: input.sessionId, requestId: input.requestId };
  writeSession('lastRequest', JSON.stringify(lastRequest));
  renderActions();
}

function renderActions() {
  const owner = currentOwner();
  const ownControl = !!owner && owner.clientId === client.clientId;
  controlButton.disabled = busy || !owner || (ownControl && owner.control !== 'none');
  controlButton.textContent = ownControl && owner?.control === 'pending' ? '等待主页面授权'
    : ownControl && owner?.control === 'granted' ? '已获授权' : '申请授权';
  submitButton.disabled = busy || !owner;
  queryButton.disabled = busy || !lastRequest;
  commandForm.setAttribute('aria-busy', String(busy));
  resultTarget.textContent = lastRequest ? `requestId: ${lastRequest.requestId} · 会话: ${lastRequest.sessionId}` : '';
}

function renderSessions() {
  sessionSelect.replaceChildren();
  const placeholder = new Option(owners.length > 1 ? '请选择 LINK 会话' : '尚未选择会话', '');
  sessionSelect.append(placeholder);
  if (selectedSessionId && !currentOwner()) {
    sessionSelect.append(new Option(`会话已离线 · ${selectedSessionId}`, selectedSessionId));
  }
  for (const owner of owners) sessionSelect.append(new Option(`${owner.title} · ${owner.connection} · ${owner.sessionId}`, owner.sessionId));
  sessionSelect.value = selectedSessionId;
  const owner = currentOwner();
  if (!owners.length) sessionStatus.textContent = '未发现 LINK 主页面，请在同一浏览器中打开同源主页面。';
  else if (!owner) sessionStatus.textContent = selectedSessionId ? '所选会话暂无响应，请确认主页面仍然打开。' : '发现多个会话，请先选择目标。';
  else if (owner.clientId === client.clientId && owner.control === 'granted') sessionStatus.textContent = `${owner.connection} · 已授权此命令页`;
  else if (owner.clientId === client.clientId && owner.control === 'pending') sessionStatus.textContent = '授权申请已发送，请在 LINK 主页面确认。';
  else if (owner.control !== 'none') sessionStatus.textContent = `${owner.connection} · 另一命令页正在申请或持有授权`;
  else sessionStatus.textContent = `${owner.connection} · 尚未授权`;
  renderActions();
}

async function discover(): Promise<OwnerSummary[]> {
  if (discovering) return discovering;
  discoverButton.disabled = true;
  discovering = client.discover().then(found => {
    owners = found;
    // Resolve only a single discovered target. A prior choice is never silently retargeted.
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

function showReply(reply: CommandReply) {
  resultOutput.textContent = JSON.stringify(reply, null, 2);
  resultStatus.dataset.status = reply.status === 'unknown' ? 'warning' : reply.ok ? 'success' : 'error';
  resultStatus.textContent = reply.status === 'unknown' ? '结果未知。请查询此 requestId，命令未自动重发。'
    : reply.status === 'accepted' ? '命令已受理，可查询后续结果。'
      : reply.ok ? '已完成' : reply.error?.message || '请求已拒绝';
}

function showError(error: unknown, code = 'INVALID_JSON') {
  const message = error instanceof Error ? error.message : String(error);
  resultOutput.textContent = JSON.stringify({ version: PROTOCOL_VERSION, ok: false, status: 'rejected', error: { code, message } }, null, 2);
  resultStatus.textContent = message;
  resultStatus.dataset.status = 'error';
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('已有请求正在处理。');
  busy = true;
  renderActions();
  try { return await operation(); }
  finally { busy = false; renderActions(); }
}

const api: AgentInterface = {
  clientId: client.clientId,
  discover,
  async requestControl(input) {
    return run(async () => {
      const owner = await client.requestControl(input);
      owners = owners.filter(item => item.sessionId !== owner.sessionId).concat(owner);
      renderSessions();
      return owner;
    });
  },
  async execute(input) {
    return run(async () => {
      rememberRequest(input);
      resultStatus.textContent = '等待命令结果…';
      resultStatus.dataset.status = '';
      const reply = await client.execute(input);
      showReply(reply);
      return reply;
    });
  },
  async result(input) {
    return run(async () => {
      rememberRequest(input);
      resultStatus.textContent = '查询结果中…';
      resultStatus.dataset.status = '';
      const reply = await client.result(input);
      showReply(reply);
      return reply;
    });
  },
};
window.ryzobeeLinkAgent = api;

sessionSelect.addEventListener('change', () => {
  selectedSessionId = sessionSelect.value;
  writeSession('sessionId', selectedSessionId);
  renderSessions();
});
discoverButton.addEventListener('click', () => { void discover().catch(() => {}); });
controlButton.addEventListener('click', () => {
  void api.requestControl({ sessionId: selectedSessionId, label: 'LINK AI 命令页' }).catch(error => showError(error, 'CONTROL_UNCONFIRMED'));
});
commandForm.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const command = parseCommand(commandInput.value);
    if (!currentOwner()) throw new Error('请先选择可用的 LINK 会话。');
    void api.execute({ ...command, sessionId: selectedSessionId }).catch(error => showError(error, 'CLIENT_BUSY'));
  } catch (error) { showError(error); }
});
queryButton.addEventListener('click', () => {
  if (lastRequest) void api.result(lastRequest).catch(error => showError(error, 'CLIENT_BUSY'));
});

renderActions();
void discover().catch(() => {});
setInterval(() => { void discover().catch(() => {}); }, 3000);
window.addEventListener('focus', () => { void discover().catch(() => {}); });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(error => console.warn('离线缓存未启用', error));
  });
}
