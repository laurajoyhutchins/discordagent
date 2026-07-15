export type JsonRpcId = number | string;

interface JsonRpcBase {
  jsonrpc?: '2.0';
}

export interface JsonRpcRequest extends JsonRpcBase {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification extends JsonRpcBase {
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess extends JsonRpcBase {
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcFailure extends JsonRpcBase {
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseJsonRpcLine(line: string): JsonRpcMessage {
  const parsed: unknown = JSON.parse(line);
  if (!isRecord(parsed)) throw new Error('Invalid JSON-RPC message');
  if (parsed.jsonrpc !== undefined && parsed.jsonrpc !== '2.0') throw new Error('Invalid JSON-RPC version');
  const hasMethod = typeof parsed.method === 'string';
  const hasResult = Object.prototype.hasOwnProperty.call(parsed, 'result');
  const hasError = isRecord(parsed.error) && typeof parsed.error.message === 'string';
  const hasId = typeof parsed.id === 'number' || typeof parsed.id === 'string' || parsed.id === null;
  if (!hasMethod && !(hasId && (hasResult || hasError))) throw new Error('Invalid JSON-RPC message');
  return parsed as unknown as JsonRpcMessage;
}
