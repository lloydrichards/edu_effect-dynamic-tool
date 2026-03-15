import { Effect, Layer, Schema } from "effect";
import { type McpSchema, Tool, Toolkit } from "effect/unstable/ai";
import {
  McpClient,
  type McpClientError,
  type McpClientOptions,
  type McpClientSession,
} from "../services/McpClient";

export type McpToolkitBundle = {
  readonly toolkit: Toolkit.Any;
  readonly layer: Layer.Layer<any>;
  readonly session: McpClientSession;
  readonly tools: ReadonlyArray<typeof McpSchema.Tool.Type>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Create an MCP toolkit from an MCP server.
 *
 * This function:
 * 1. Connects to the MCP server and initializes a session
 * 2. Fetches all available tools
 * 3. Creates a dynamic toolkit with handlers that call the MCP server
 */
export const createMcpToolkit = (
  options: McpClientOptions & {
    readonly namePrefix?: string;
  },
): Effect.Effect<McpToolkitBundle, McpClientError> =>
  Effect.gen(function* () {
    const mcpClientLayer = McpClient.layer(options);
    const { session, tools } = yield* Effect.scoped(
      Effect.gen(function* () {
        const client = yield* McpClient;
        const session = yield* client.getSession();
        const tools = yield* client.listAllTools();
        return { session, tools };
      }).pipe(Effect.provide(mcpClientLayer)),
    );

    if (tools.length === 0) {
      return {
        toolkit: Toolkit.empty,
        layer: Layer.empty as Layer.Layer<any>,
        session,
        tools,
      } satisfies McpToolkitBundle;
    }

    const dynamicTools = tools.map((tool) =>
      Tool.dynamic(`${options.namePrefix}${tool.name}`, {
        description: tool.description,
        parameters: tool.inputSchema,
        success: Schema.Unknown,
        failure: Schema.String,
        failureMode: "return",
      }),
    );

    const toolkit = Toolkit.make(...dynamicTools);

    const handlers = toolkit.of(
      Object.fromEntries(
        tools.map((tool) => [
          `${options.namePrefix}${tool.name}`,
          (input: unknown) =>
            Effect.gen(function* () {
              if (!isRecord(input)) {
                return yield* Effect.fail(
                  `MCP tool "${tool.name}" expected an object input.`,
                );
              }

              const client = yield* McpClient;
              const result = yield* client
                .callTool({
                  name: tool.name,
                  arguments: input,
                })
                .pipe(
                  Effect.mapError(
                    (error) =>
                      `MCP tool "${tool.name}" failed: ${error.message}`,
                  ),
                );

              if (result.isError) {
                return yield* Effect.fail(
                  `MCP tool "${tool.name}" failed: ${result.content}`,
                );
              }

              return result.structuredContent || result.content;
            }).pipe(
              Effect.provide(mcpClientLayer),
              Effect.catch((error) =>
                Effect.fail(
                  typeof error === "string"
                    ? error
                    : `MCP tool "${tool.name}" failed: ${error.message}`,
                ),
              ),
            ),
        ]),
      ),
    );

    return {
      toolkit,
      layer: toolkit.toLayer(handlers),
      session,
      tools,
    } satisfies McpToolkitBundle;
  });
