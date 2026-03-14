import { Data, Effect, Layer, Schema, ServiceMap } from "effect";
import { McpSchema } from "effect/unstable/ai";
import {
  FetchHttpClient,
  Headers,
  HttpBody,
  HttpClient,
  type HttpClientError,
} from "effect/unstable/http";

type JsonRpcId = string | number;
type JsonObject = Record<string, unknown>;

const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_CLIENT_INFO: McpSchema.Implementation = {
  name: "edu-effect-dynamic-tool-server",
  version: "0.0.1",
};

let nextJsonRpcRequestId = 1;

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

/**
 * Parameters for tools/call
 */
export type McpToolCallParams = {
  readonly name: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
};

export class McpClientError extends Data.TaggedError("McpClientError")<{
  readonly method: string;
  readonly url: string;
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
  readonly details?: unknown;
}> {}

type JsonRpcSuccess<T> = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: T;
};

type JsonRpcFailure = {
  readonly jsonrpc: "2.0";
  readonly id?: JsonRpcId | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
};

/**
 * Initialize result schema - local version that allows optional protocolVersion
 * since some MCP servers may omit it in practice, unlike McpSchema.InitializeResult
 * which requires it per the spec.
 */
const InitializeResultSchema = Schema.Struct({
  protocolVersion: Schema.optional(Schema.String),
  capabilities: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  serverInfo: Schema.optional(McpSchema.Implementation),
  instructions: Schema.optional(Schema.String),
});

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null;

const parseJson = (text: string, method: string, url: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) =>
      new McpClientError({
        method,
        url,
        message: "Received invalid JSON from MCP endpoint",
        cause,
        details: text,
      }),
  });

const extractSseJsonPayload = (text: string): string | undefined => {
  const payloads = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line.length > 0);

  return payloads.at(-1);
};

const parseOptionalJson = (text: string, method: string, url: string) =>
  text.trim().length === 0
    ? Effect.succeed(undefined as unknown)
    : parseJson(text, method, url).pipe(
        Effect.catchTag("McpClientError", (error) => {
          const ssePayload = extractSseJsonPayload(text);

          if (!ssePayload) {
            return Effect.fail(error);
          }

          return parseJson(ssePayload, method, url);
        }),
      );

const buildHeaders = (
  headers?: Readonly<Record<string, string>>,
  sessionId?: string,
): Headers.Headers => {
  const baseHeaders: Record<string, string> = {
    accept: "application/json, text/event-stream",
  };

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      baseHeaders[key] = value;
    }
  }

  if (sessionId) {
    baseHeaders["mcp-session-id"] = sessionId;
  }

  return Headers.fromInput(baseHeaders);
};

const ensureJsonRpcSuccess = <T>(
  payload: unknown,
  method: string,
  url: string,
): Effect.Effect<T, McpClientError> =>
  Effect.gen(function* () {
    if (!isRecord(payload)) {
      return yield* Effect.fail(
        new McpClientError({
          method,
          url,
          message: "Expected a JSON object from MCP endpoint",
          details: payload,
        }),
      );
    }

    if ("error" in payload) {
      const error = payload as unknown as JsonRpcFailure;

      return yield* Effect.fail(
        new McpClientError({
          method,
          url,
          message: error.error?.message ?? "MCP request failed",
          details: error.error,
        }),
      );
    }

    if (!("result" in payload)) {
      return yield* Effect.fail(
        new McpClientError({
          method,
          url,
          message: "Missing JSON-RPC result in MCP response",
          details: payload,
        }),
      );
    }

    return (payload as unknown as JsonRpcSuccess<T>).result;
  });

const ensureNoJsonRpcError = (payload: unknown, method: string, url: string) =>
  Effect.gen(function* () {
    if (payload === undefined) {
      return;
    }

    if (!isRecord(payload)) {
      return yield* Effect.fail(
        new McpClientError({
          method,
          url,
          message: "Expected a JSON object from MCP endpoint",
          details: payload,
        }),
      );
    }

    if ("error" in payload) {
      const error = payload as unknown as JsonRpcFailure;

      return yield* Effect.fail(
        new McpClientError({
          method,
          url,
          message: error.error?.message ?? "MCP notification failed",
          details: error.error,
        }),
      );
    }
  });

/**
 * Map HttpClientError to McpClientError for consistent error handling
 */
const mapHttpClientError = (
  error: HttpClientError.HttpClientError,
  method: string,
  url: string,
): McpClientError => {
  const isStatusCodeError = error.reason._tag === "StatusCodeError";
  const message = isStatusCodeError
    ? `MCP endpoint returned HTTP ${error.reason.response.status}`
    : error.reason._tag === "TransportError"
      ? "Failed to reach MCP endpoint"
      : "HTTP client error";

  return new McpClientError({
    method,
    url,
    message,
    ...(isStatusCodeError ? { status: error.reason.response.status } : {}),
    cause: error,
  });
};

const postJsonRpc = (
  httpClient: HttpClient.HttpClient,
  url: string,
  request: {
    readonly method: string;
    readonly params?: unknown;
    readonly id?: JsonRpcId;
  },
  headers?: Readonly<Record<string, string>>,
  sessionId?: string,
) =>
  Effect.gen(function* () {
    const jsonRpcBody = {
      jsonrpc: "2.0" as const,
      id: request.id,
      method: request.method,
      params: request.params,
    };

    const response = yield* httpClient
      .post(url, {
        body: HttpBody.jsonUnsafe(jsonRpcBody),
        headers: buildHeaders(headers, sessionId),
      })
      .pipe(
        Effect.mapError((error) =>
          mapHttpClientError(error, request.method, url),
        ),
      );

    const bodyText = yield* response.text.pipe(
      Effect.mapError(
        (error) =>
          new McpClientError({
            method: request.method,
            url,
            message: "Failed to read MCP response body",
            cause: error,
            status: response.status,
          }),
      ),
    );

    const body = yield* parseOptionalJson(bodyText, request.method, url);

    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        new McpClientError({
          method: request.method,
          url,
          message: `MCP endpoint returned HTTP ${response.status}`,
          status: response.status,
          details: body ?? bodyText,
        }),
      );
    }

    return {
      body,
      headers: response.headers,
    };
  });

/**
 * Create a decoder that validates a value against a Schema and maps errors to McpClientError.
 * Only works with schemas that have no DecodingServices requirement.
 */
const decodeWithSchema =
  <S extends Schema.Top & { readonly DecodingServices: never }>(
    schema: S,
    method: string,
    url: string,
  ) =>
  (value: unknown): Effect.Effect<S["Type"], McpClientError> =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(
        (parseError) =>
          new McpClientError({
            method,
            url,
            message: "Invalid MCP response: schema validation failed",
            details: parseError.message,
            cause: parseError,
          }),
      ),
    );

const sendRequest = <T>(
  httpClient: HttpClient.HttpClient,
  url: string,
  method: string,
  params?: unknown,
  headers?: Readonly<Record<string, string>>,
  sessionId?: string,
): Effect.Effect<
  {
    readonly result: T;
    readonly sessionId?: string;
  },
  McpClientError
> =>
  Effect.gen(function* () {
    const id = nextJsonRpcRequestId++;
    const response = yield* postJsonRpc(
      httpClient,
      url,
      {
        id,
        method,
        params,
      },
      headers,
      sessionId,
    );

    const result = yield* ensureJsonRpcSuccess<T>(response.body, method, url);
    const resolvedSessionId =
      Headers.get(response.headers, "mcp-session-id") ?? sessionId;

    if (resolvedSessionId) {
      return {
        result,
        sessionId: resolvedSessionId,
      };
    }

    return {
      result,
    };
  });

const sendNotification = (
  httpClient: HttpClient.HttpClient,
  url: string,
  method: string,
  params?: unknown,
  headers?: Readonly<Record<string, string>>,
  sessionId?: string,
) =>
  Effect.gen(function* () {
    const response = yield* postJsonRpc(
      httpClient,
      url,
      {
        method,
        params,
      },
      headers,
      sessionId,
    );

    yield* ensureNoJsonRpcError(response.body, method, url);
  });

/**
 * MCP Client Service shape - the methods available on the service.
 */
export type McpClientShape = {
  readonly getSession: () => Effect.Effect<McpClientSession>;
  readonly listTools: (
    cursor?: string,
  ) => Effect.Effect<typeof McpSchema.ListToolsResult.Type, McpClientError>;
  readonly listAllTools: () => Effect.Effect<
    ReadonlyArray<typeof McpSchema.Tool.Type>,
    McpClientError
  >;
  readonly callTool: (
    params: McpToolCallParams,
  ) => Effect.Effect<typeof McpSchema.CallToolResult.Type, McpClientError>;
};

/**
 * MCP Client Service - manages connection to an MCP server.
 *
 * Use `McpClient.layer(options)` to create a layer for a specific MCP server.
 */
export class McpClient extends ServiceMap.Service<McpClient, McpClientShape>()(
  "McpClient",
) {
  /**
   * Create a layer for an MCP client connected to a specific server.
   * The session is initialized once when the layer is created.
   */
  static layer(
    options: McpClientOptions,
  ): Layer.Layer<McpClient, McpClientError> {
    return Layer.effect(McpClient)(
      Effect.gen(function* () {
        const httpClient = yield* HttpClient.HttpClient;

        yield* Effect.log(`Initializing MCP client for ${options.url}`);

        const clientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO;
        const protocolVersion =
          options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
        const capabilities = options.capabilities ?? {};

        // Initialize the MCP session
        const initResponse = yield* sendRequest<unknown>(
          httpClient,
          options.url,
          "initialize",
          {
            protocolVersion,
            capabilities,
            clientInfo,
          },
          options.headers,
        );

        // Validate the initialize result with our local schema
        const initializeResult = yield* decodeWithSchema(
          InitializeResultSchema,
          "initialize",
          options.url,
        )(initResponse.result);

        yield* sendNotification(
          httpClient,
          options.url,
          "notifications/initialized",
          undefined,
          options.headers,
          initResponse.sessionId,
        );

        const session: McpClientSession = {
          url: options.url,
          ...(options.headers ? { headers: options.headers } : {}),
          ...(initResponse.sessionId
            ? { sessionId: initResponse.sessionId }
            : {}),
          protocolVersion: initializeResult.protocolVersion ?? protocolVersion,
          clientInfo,
          capabilities: initializeResult.capabilities ?? {},
          ...(initializeResult.serverInfo
            ? { serverInfo: initializeResult.serverInfo }
            : {}),
          ...(initializeResult.instructions
            ? { instructions: initializeResult.instructions }
            : {}),
        };

        yield* Effect.log(
          `MCP session established with ${session.serverInfo?.name ?? options.url}`,
        );

        // Service methods that use the initialized session

        const getSession = () => Effect.succeed(session);

        const listTools = (cursor?: string) =>
          Effect.gen(function* () {
            const response = yield* sendRequest<unknown>(
              httpClient,
              session.url,
              "tools/list",
              cursor ? { cursor } : undefined,
              session.headers,
              session.sessionId,
            );

            // Validate with McpSchema.ListToolsResult
            const validated = yield* decodeWithSchema(
              McpSchema.ListToolsResult,
              "tools/list",
              session.url,
            )(response.result);

            return validated;
          });

        const listAllToolsRecursive = (
          cursor?: string,
          acc: ReadonlyArray<typeof McpSchema.Tool.Type> = [],
        ): Effect.Effect<
          ReadonlyArray<typeof McpSchema.Tool.Type>,
          McpClientError
        > =>
          listTools(cursor).pipe(
            Effect.flatMap((page) => {
              const tools = [...acc, ...page.tools];

              return page.nextCursor
                ? listAllToolsRecursive(page.nextCursor, tools)
                : Effect.succeed(tools);
            }),
          );

        const listAllTools = () => listAllToolsRecursive();

        const callTool = (params: McpToolCallParams) =>
          Effect.gen(function* () {
            const response = yield* sendRequest<unknown>(
              httpClient,
              session.url,
              "tools/call",
              {
                name: params.name,
                arguments: params.arguments,
              },
              session.headers,
              session.sessionId,
            );

            // Validate with McpSchema.CallToolResult
            const validated = yield* decodeWithSchema(
              McpSchema.CallToolResult,
              "tools/call",
              session.url,
            )(response.result);

            return validated;
          });

        return McpClient.of({
          getSession,
          listTools,
          listAllTools,
          callTool,
        });
      }),
    ).pipe(Layer.provide(FetchHttpClient.layer));
  }
}
