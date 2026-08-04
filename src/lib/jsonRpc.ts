export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: JsonValue;
}

export interface JsonRpcEvent {
  type?: string;
  session_id?: string;
  [key: string]: JsonValue | undefined;
}

export interface JsonRpcFrame {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: JsonValue;
  result?: JsonValue;
  error?: { code?: number; message?: string; data?: JsonValue } | string;
  type?: string;
  session_id?: string;
  [key: string]: JsonValue | undefined | { code?: number; message?: string; data?: JsonValue };
}

export class JsonRpcPeer {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: JsonValue) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly socket: WebSocket, private readonly timeoutMs = 30_000) {}

  request(method: string, params: JsonValue = {}, options: { timeoutMs?: number } = {}): Promise<JsonValue> {
    const id = this.nextId++;
    const frame: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const promise = new Promise<JsonValue>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify(frame));
    return promise;
  }

  handleFrame(frame: JsonRpcFrame): JsonRpcEvent | null {
    if (typeof frame.id === 'number' && this.pending.has(frame.id)) {
      const waiter = this.pending.get(frame.id)!;
      globalThis.clearTimeout(waiter.timer);
      this.pending.delete(frame.id);
      if (frame.error) {
        const message = typeof frame.error === 'string' ? frame.error : frame.error.message ?? 'JSON-RPC error';
        waiter.reject(new Error(message));
      } else {
        waiter.resolve(frame.result ?? null);
      }
      return null;
    }
    if (frame.method && typeof frame.params === 'object' && frame.params !== null && !Array.isArray(frame.params)) {
      return { ...(frame.params as Record<string, JsonValue>), type: frame.method };
    }
    if (frame.type) return frame as JsonRpcEvent;
    return null;
  }

  rejectAll(reason: Error): void {
    for (const [id, waiter] of this.pending) {
      globalThis.clearTimeout(waiter.timer);
      waiter.reject(reason);
      this.pending.delete(id);
    }
  }
}

export function parseJsonRpcMessage(text: string): JsonRpcFrame[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as JsonRpcFrame];
      } catch {
        return [];
      }
    });
}

export function asRecord(value: JsonValue): Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, JsonValue>) : {};
}
