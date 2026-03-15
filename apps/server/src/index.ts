import * as NodeSdk from "@effect/opentelemetry/NodeSdk";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Api } from "@repo/domain/Api";
import { EventRpc } from "@repo/domain/Rpc";
import { Config, Effect, Layer, Option } from "effect";
import { Prompt } from "effect/unstable/ai";
import { DevTools } from "effect/unstable/devtools";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { ChatService } from "./services/ChatService";
import { AnthropicModelLive } from "./services/LanguageModel";
import { ExternalMcpToolkitLive } from "./toolkits/ExternalMcpToolkit";
import { LocalMcpToolkitLive } from "./toolkits/LocalMcpToolkit";
import { SampleToolkitLive } from "./toolkits/SampleToolkit";

const HealthGroupLive = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers.handle("get", () => Effect.succeed("Hello Effect!")),
);

const EventRpcLive = EventRpc.toLayer(
  Effect.gen(function* () {
    const chatService = yield* ChatService;
    yield* Effect.log("Starting Event RPC Live Implementation");
    return {
      chat: ({ messages }) =>
        chatService.chat(
          messages.map((msg) => {
            if (msg.role === "system") {
              return Prompt.makeMessage(msg.role, {
                content: msg.content,
              });
            }
            return Prompt.makeMessage(msg.role, {
              content: [Prompt.makePart("text", { text: msg.content })],
            });
          }),
        ),
    };
  }),
);

// ============================================================================
// Server Configuration
// ============================================================================

const ServerConfig = Config.all({
  port: Config.number("PORT").pipe(Config.withDefault(9000)),
  hostname: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
  idleTimeout: Config.number("IDLE_TIMEOUT").pipe(Config.withDefault(120)), // seconds (Bun default is 10)
  allowedOrigins: Config.string("ALLOWED_ORIGINS").pipe(
    Config.withDefault("http://localhost:3000"),
  ),
  enableDevTools: Config.boolean("DEVTOOLS").pipe(Config.withDefault(false)),
});

const TracingConfig = Config.all({
  exporterEndpoint: Config.option(Config.string("OTEL_EXPORTER_OTLP_ENDPOINT")),
  serviceName: Config.option(Config.string("OTEL_SERVICE_NAME")),
});

// ============================================================================
// Router Composition
// ============================================================================

// HTTP API Router
const ApiRouter = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(HealthGroupLive),
);

// HTTP RPC Router (for EventRpc - streaming over HTTP)
const HttpRpcRouter = RpcServer.layerHttp({
  group: EventRpc,
  path: "/rpc",
  protocol: "http", // Use HTTP for EventRpc
  spanPrefix: "rpc",
}).pipe(
  Layer.provide(EventRpcLive),
  Layer.provide(Layer.effect(ChatService)(ChatService.make)),
  Layer.provide(SampleToolkitLive),
  Layer.provide(LocalMcpToolkitLive),
  Layer.provide(ExternalMcpToolkitLive),
  Layer.provide(AnthropicModelLive),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(RpcSerialization.layerNdjson),
);

// ============================================================================
// Server Launch
// ============================================================================
const NodeSdkLive = Effect.gen(function* () {
  const tracing = yield* TracingConfig;
  const endpoint = Option.getOrUndefined(tracing.exporterEndpoint);
  const serviceName = Option.getOrUndefined(tracing.serviceName);

  if (!endpoint || !serviceName) {
    yield* Effect.log(
      "OTEL tracing disabled (set OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_SERVICE_NAME to enable)",
    );
    return Layer.empty;
  }

  yield* Effect.log(`OTEL tracing enabled: ${serviceName} -> ${endpoint}`);
  return NodeSdk.layer(() => ({
    resource: { serviceName },
    spanProcessor: new BatchSpanProcessor(
      new OTLPTraceExporter({ url: endpoint }),
    ),
  }));
}).pipe(Layer.unwrap);

const DevToolsLive = Effect.gen(function* () {
  const config = yield* ServerConfig;
  if (!config.enableDevTools) {
    return Layer.empty;
  }
  yield* Effect.log("Enabling DevTools Layer");
  return DevTools.layer();
}).pipe(Layer.unwrap);

const HttpLive = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const allowedOrigins = config.allowedOrigins.split(",").map((o) => o.trim());

  yield* Effect.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);
  yield* Effect.log("Starting server with:");
  yield* Effect.log("  - HTTP API at /");
  yield* Effect.log("  - HTTP RPC at /rpc (EventRpc)");
  yield* Effect.log("  - WebSocket RPC at /ws (PresenceRpc)");

  const AllRouters = Layer.mergeAll(ApiRouter, HttpRpcRouter).pipe(
    Layer.provide(
      HttpRouter.cors({
        allowedOrigins,
        allowedMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "B3", "traceparent"],
        credentials: true,
      }),
    ),
  );

  return HttpRouter.serve(AllRouters).pipe(
    HttpServer.withLogAddress,
    Layer.provideMerge(DevToolsLive),
    Layer.provideMerge(NodeSdkLive),
    Layer.provideMerge(BunHttpServer.layerConfig(ServerConfig)),
  );
}).pipe(Layer.unwrap, Layer.launch);

BunRuntime.runMain(HttpLive as Effect.Effect<never, never, never>);
