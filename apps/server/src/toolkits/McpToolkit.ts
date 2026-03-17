import { Effect, Layer, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { McpClient, type McpClientOptions } from "../services/McpClient";

type McpToolkitOptions = McpClientOptions & {
  readonly namePrefix?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const createMcpToolkit = (options: McpToolkitOptions) =>
  Effect.gen(function* () {
    const mcpClientLayer = Layer.effect(McpClient)(McpClient.make(options));
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
        layer: Layer.empty,
        session,
        tools,
      };
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
                .toolCall({
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
    };
  });

export type McpToolkit = Effect.Success<ReturnType<typeof createMcpToolkit>>;
