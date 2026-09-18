import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export const MCP_VERSION = '2025-11-25' as const;
export const ROUTE_META = 'com.ryzobee.link/transport';
export const channelName = () => `ryzobee-link:mcp:v1:${new URL(import.meta.env.BASE_URL, location.href).pathname}`;
export type McpResponse = Extract<JSONRPCMessage, { result: unknown } | { error: unknown }>;

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
declare global {
  interface Window { ryzobeeLink?: { request(message: unknown): Promise<McpResponse | undefined> } }
}
