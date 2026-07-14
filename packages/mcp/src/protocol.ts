/**
 * MCP over stdio — newline-delimited JSON-RPC 2.0, dependency-free
 * (docs/spec/mcp.md § Packaging & Transport). The spec's SDK caveat taken to
 * its conclusion: `@modelcontextprotocol/sdk` pins zod 3 against the
 * workspace's zod 4, and the protocol surface this server needs
 * (`initialize`, `tools/list`, `tools/call`, `ping`) is small enough to
 * speak directly — `@arkaik/schema` stays the only validation authority.
 * The tool catalog is the contract; adopting the SDK later changes plumbing,
 * not behavior.
 */

import { createInterface } from "node:readline";

/** The MCP revision this server implements; echoed back on initialize. */
const PROTOCOL_VERSION = "2025-06-18";

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * A handler returns the JSON payload for the tool result; throw `ToolError`
 * for expected, agent-actionable failures (unknown node, refused mutation) —
 * they become `isError` tool results, not protocol errors.
 */
export type ToolHandler = (args: Record<string, unknown>) => unknown;

export class ToolError extends Error {
  /** Structured payload serialized as the error content (e.g. validator findings). */
  readonly payload?: unknown;

  constructor(message: string, payload?: unknown) {
    super(message);
    this.name = "ToolError";
    this.payload = payload;
  }
}

export interface ServerOptions {
  serverInfo: { name: string; version: string };
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

/** Start the stdio loop. Resolves when the input stream closes. */
export function startServer(options: ServerOptions): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  const send = (message: Record<string, unknown>) => {
    output.write(`${JSON.stringify(message)}\n`);
  };
  const respond = (id: number | string | null, result: unknown) => {
    send({ jsonrpc: "2.0", id, result });
  };
  const respondError = (id: number | string | null, code: number, message: string) => {
    send({ jsonrpc: "2.0", id, error: { code, message } });
  };

  const handleToolCall = (id: number | string | null, params: Record<string, unknown>) => {
    const name = params.name;
    if (typeof name !== "string") {
      respondError(id, JSONRPC_INVALID_PARAMS, "tools/call requires a string `name`.");
      return;
    }
    const handler = options.handlers[name];
    if (!handler) {
      respondError(id, JSONRPC_INVALID_PARAMS, `Unknown tool: ${name}`);
      return;
    }

    const args =
      typeof params.arguments === "object" && params.arguments !== null && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};

    try {
      const result = handler(args);
      respond(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (error) {
      if (error instanceof ToolError) {
        const body = error.payload !== undefined ? { message: error.message, ...asObject(error.payload) } : { message: error.message };
        respond(id, { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError: true });
      } else {
        respondError(id, JSONRPC_INTERNAL_ERROR, (error as Error).message);
      }
    }
  };

  const handle = (message: JsonRpcMessage) => {
    const id = message.id ?? null;
    switch (message.method) {
      case "initialize": {
        const requested = message.params?.protocolVersion;
        respond(id, {
          protocolVersion: typeof requested === "string" ? requested : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: options.serverInfo,
        });
        return;
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return; // notifications get no response
      case "ping":
        respond(id, {});
        return;
      case "tools/list":
        respond(id, { tools: options.tools });
        return;
      case "tools/call":
        handleToolCall(id, message.params ?? {});
        return;
      default:
        if (message.id !== undefined) {
          respondError(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${message.method ?? "(none)"}`);
        }
    }
  };

  return new Promise((resolvePromise) => {
    const lines = createInterface({ input });
    lines.on("line", (line) => {
      if (!line.trim()) return;
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        respondError(null, JSONRPC_PARSE_ERROR, "Parse error");
        return;
      }
      handle(message);
    });
    lines.on("close", () => resolvePromise());
  });
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { detail: value };
}
