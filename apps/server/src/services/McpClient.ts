import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Data, Effect, ServiceMap } from "effect";
import type { JsonObject } from "effect/Schema";
import type { McpSchema } from "effect/unstable/ai";

const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_CLIENT_INFO: McpSchema.Implementation = {
  name: "edu-effect-dynamic-tool-server",
  version: "0.0.1",
};

export type McpClientOptions = {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly protocolVersion?: string;
  readonly clientInfo?: McpSchema.Implementation;
  readonly capabilities?: JsonObject;
};

export type McpClientSession = {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly sessionId?: string;
  readonly protocolVersion: string;
  readonly clientInfo: McpSchema.Implementation;
  readonly serverInfo?: McpSchema.Implementation;
  readonly capabilities: JsonObject;
  readonly instructions?: string;
};

export class McpClientError extends Data.TaggedError("McpClientError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type McpToolCallParams = {
  readonly name: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
};

export class McpClient extends ServiceMap.Service<McpClient>()("McpClient", {
  make: (options: McpClientOptions) =>
    Effect.gen(function* () {
      const client = new Client({
        name: options.clientInfo?.name ?? DEFAULT_CLIENT_INFO.name,
        version: options.clientInfo?.version ?? DEFAULT_CLIENT_INFO.version,
      });

      const transport = new StreamableHTTPClientTransport(new URL(options.url));

      yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: (signal) => client.connect(transport as Transport, { signal }),
          catch: (cause) =>
            new McpClientError({
              message: "Failed to connect MCP SDK client",
              cause,
            }),
        }),
        () => Effect.promise(() => client.close()),
      );

      const session: McpClientSession = {
        url: options.url,
        ...(options.headers ? { headers: options.headers } : {}),
        protocolVersion: options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
        clientInfo: options.clientInfo ?? DEFAULT_CLIENT_INFO,
        capabilities: options.capabilities ?? {},
      };

      const getSession = () => Effect.succeed(session);

      const listAllTools = () =>
        Effect.tryPromise({
          try: async () => {
            const tools: Array<typeof McpSchema.Tool.Type> = [];
            let cursor: string | undefined;

            do {
              const page = await client.listTools({ cursor });
              tools.push(...(page.tools as Array<typeof McpSchema.Tool.Type>));
              cursor = page.nextCursor ?? undefined;
            } while (cursor);

            return tools;
          },
          catch: (cause) =>
            new McpClientError({
              message: "Failed to list MCP tools",
              cause,
            }),
        });

      const toolCall = (params: McpToolCallParams) =>
        Effect.tryPromise({
          try: async () =>
            await client.callTool({
              name: params.name,
              arguments: params.arguments,
            }),
          catch: (cause) =>
            new McpClientError({
              message: "Failed to call MCP tool",
              cause,
            }),
        });

      return {
        getSession,
        listAllTools,
        toolCall,
      };
    }),
}) {}
