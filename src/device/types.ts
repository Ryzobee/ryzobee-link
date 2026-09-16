/** Web Serial's narrow browser-only surface; injected in tests. */
export interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  setSignals?(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
}

export interface SerialAPI {
  requestPort(): Promise<SerialPortLike>;
}

export interface DeviceFile { name: string; bytes: number; protected: boolean }
export interface FileSource { name: string; source: string; sha256: string; bytes: number }
export interface FileDescription extends DeviceFile {
  sha256: string;
  created_at?: string | null;
  modified_at?: string | null;
}
export interface StorageStatus {
  ready: boolean;
  recovery_required: boolean;
  capacity_valid: boolean;
  total_bytes: number | null;
  used_bytes: number | null;
  revision: number;
}
export interface Job {
  job_id: string;
  name: string;
  state: 'running' | 'done' | 'stopped' | 'timeout' | 'failed';
  sha256?: string;
  elapsed_ms?: number;
  dropped_bytes?: number;
  stop_requested?: boolean;
  error?: string;
}
export interface BoardInfo {
  chip: string;
  firmware: string;
  boot_id: string;
  protocol_version: number;
  lua?: string;
  device_id?: string;
  source_limit_bytes?: number;
  free_internal_bytes?: number;
  free_psram_bytes?: number;
  job?: Job | null;
  recent_job?: Job | null;
}
export interface AnsiSpan { text: string; color?: string; bold?: boolean; dim?: boolean }
export interface LogRow {
  id: number;
  time: number;
  kind: 'system' | 'command' | 'output' | 'job' | 'error';
  text: string;
  spans: AnsiSpan[];
  jobId?: string;
}
export interface DeviceSnapshot {
  /** serial-open means an open UART, not a recognized Ryzobee device. */
  connection: 'disconnected' | 'connecting' | 'serial-open' | 'ready';
  info: BoardInfo | null;
  files: DeviceFile[];
  storage: StorageStatus | null;
  jobs: Job[];
  logs: LogRow[];
  unknown: string[];
  error: string | null;
}
