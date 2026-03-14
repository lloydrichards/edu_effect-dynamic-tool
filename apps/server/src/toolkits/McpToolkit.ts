import { Effect, Layer, Schema } from "effect";
import type * as JsonSchema from "effect/JsonSchema";
import { type McpSchema, Tool, Toolkit } from "effect/unstable/ai";
import {
  McpClient,
  type McpClientError,
  type McpClientOptions,
  type McpClientSession,
} from "../services/McpClient";

export interface McpToolkitBundle {
  readonly toolkit: Toolkit.Any;
  readonly layer: Layer.Layer<any>;
  readonly session: McpClientSession;
  readonly tools: ReadonlyArray<typeof McpSchema.Tool.Type>;
}

export interface McpToolkitOptions extends McpClientOptions {
  readonly namePrefix?: string;
}

const defaultParametersSchema: JsonSchema.JsonSchema = {
  type: "object",
  additionalProperties: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPlainJsonObject = (
  value: unknown,
): value is Record<string, unknown> => {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const getParametersSchema = (inputSchema: unknown): JsonSchema.JsonSchema =>
  isRecord(inputSchema) ? inputSchema : defaultParametersSchema;

const getToolName = (toolName: string, namePrefix?: string) =>
  namePrefix ? `${namePrefix}${toolName}` : toolName;

const stringifyJson = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
};

const formatMcpToolResult = (
  result: typeof McpSchema.CallToolResult.Type,
): string => {
  const textParts = (result.content ?? []).flatMap((item) => {
    if (
      isRecord(item) &&
      item["type"] === "text" &&
      typeof item["text"] === "string"
    ) {
      return [item["text"]];
    }

    return [];
  });

  if (textParts.length > 0) {
    return textParts.join("\n\n");
  }

  if (result.structuredContent !== undefined) {
    return stringifyJson(result.structuredContent);
  }

  return stringifyJson(result);
};

/**
 * Create an MCP toolkit from an MCP server.
 *
 * This function:
 * 1. Connects to the MCP server and initializes a session
 * 2. Fetches all available tools
 * 3. Creates a dynamic toolkit with handlers that call the MCP server
 *
 * The returned bundle includes the toolkit, a layer to provide the handlers,
 * the session info, and the list of tools.
 */
export const createMcpToolkit = (
  options: McpToolkitOptions,
): Effect.Effect<McpToolkitBundle, McpClientError> =>
  Effect.gen(function* () {
    // Create the MCP client layer and use it to get tools
    const mcpClientLayer = McpClient.layer(options);

    // Build the client and get session/tools
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
      Tool.dynamic(getToolName(tool.name, options.namePrefix), {
        description: tool.description,
        parameters: getParametersSchema(tool.inputSchema),
        success: Schema.String,
        failure: Schema.String,
        failureMode: "return",
      }),
    );

    const toolkit = Toolkit.make(...dynamicTools);

    // Create handlers that use a fresh McpClient for each call
    const handlers = toolkit.of(
      Object.fromEntries(
        tools.map((tool) => [
          getToolName(tool.name, options.namePrefix),
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
                  arguments: isPlainJsonObject(input)
                    ? input
                    : yield* Effect.fail(
                        `MCP tool "${tool.name}" expected a plain JSON object input.`,
                      ),
                })
                .pipe(
                  Effect.mapError(
                    (error) =>
                      `MCP tool "${tool.name}" failed: ${error.message}`,
                  ),
                );

              const text = formatMcpToolResult(result);

              if (result.isError) {
                return yield* Effect.fail(
                  `MCP tool "${tool.name}" failed: ${text}`,
                );
              }

              return text;
            }).pipe(
              Effect.provide(mcpClientLayer),
              // Catch any remaining McpClientError from layer initialization
              Effect.catch((error: string | McpClientError) =>
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
