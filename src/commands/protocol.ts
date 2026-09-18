export const PROTOCOL_VERSION = 1 as const;
export const channelName = () => `ryzobee-link:commands:v1:${new URL(import.meta.env.BASE_URL, location.href).pathname}`;

export interface OwnerSummary {
  version: 1;
  sessionId: string;
  title: string;
  connection: string;
  control: 'none' | 'pending' | 'granted';
  clientId?: string;
}
export interface CommandRequest {
  version: 1;
  sessionId: string;
  clientId: string;
  requestId: string;
  command: string;
  args?: Record<string, unknown>;
  expiresAt?: number;
}
export interface CommandReply {
  version: 1;
  sessionId: string;
  requestId: string;
  ok: boolean;
  status: 'completed' | 'accepted' | 'rejected' | 'unknown';
  data?: unknown;
  error?: { code: string; message: string };
}
export interface LinkPageInterface {
  hello(): OwnerSummary;
  requestControl(input: { clientId: string; label?: string }): OwnerSummary;
  execute(request: CommandRequest): Promise<CommandReply>;
  result(input: { sessionId: string; clientId: string; requestId: string }): CommandReply;
}
export type BridgeRequest = {
  type: 'link-command-request';
  version: 1;
  transportId: string;
  clientId: string;
  sessionId?: string;
  action: 'discover' | 'control' | 'execute' | 'result';
  label?: string;
  request?: CommandRequest;
  requestId?: string;
};
export type BridgeResponse = {
  type: 'link-command-response';
  version: 1;
  transportId: string;
  clientId: string;
  sessionId: string;
  data: OwnerSummary | CommandReply;
};
declare global {
  interface Window { ryzobeeLink?: LinkPageInterface }
}
