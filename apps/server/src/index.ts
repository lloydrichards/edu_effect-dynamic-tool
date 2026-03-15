import * as NodeSdk from "@effect/opentelemetry/NodeSdk";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Api, type ApiResponse } from "@repo/domain/Api";
import { EventRpc, type TickEvent } from "@repo/domain/Rpc";
import {
  type ClientInfo,
  type WebSocketEvent,
  WebSocketRpc,
} from "@repo/domain/WebSocket";
import {
  type Cause,
  Config,
  Effect,
  Layer,
  Option,
  Queue,
  Stream,
} from "effect";
import { Prompt } from "effect/unstable/ai";
import { DevTools } from "effect/unstable/devtools";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { ChatService } from "./services/ChatService";
import { AnthropicModelLive } from "./services/LanguageModel";
import { PresenceService } from "./services/PresenceService";
import { ExternalMcpToolkitLive } from "./toolkits/ExternalMcpToolkit";
import { LocalMcpToolkitLive } from "./toolkits/LocalMcpToolkit";
import { SampleToolkitLive } from "./toolkits/SampleToolkit";

const HealthGroupLive = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers.handle("get", () => Effect.succeed("Hello Effect!")),
);

const HelloGroupLive = HttpApiBuilder.group(Api, "hello", (handlers) =>
  handlers.handle("get", () => {
    const data: typeof ApiResponse.Type = {
      message: "Hello bEvr!",
      success: true,
    };
    return Effect.succeed(data);
  }),
);

const EventRpcLive = EventRpc.toLayer(
  Effect.gen(function* () {
    const chatService = yield* ChatService;
    yield* Effect.log("Starting Event RPC Live Implementation");
    return {
      tick: Effect.fn(function* (payload) {
        yield* Effect.log("Creating new tick stream");
        const queue = yield* Queue.make<typeof TickEvent.Type, Cause.Done>();
        yield* Effect.forkScoped(
          Effect.gen(function* () {
            yield* Queue.offer(queue, { _tag: "starting" });
            yield* Effect.sleep("3 seconds");
            for (let i = 0; i < payload.ticks; i++) {
              yield* Effect.sleep("1 second");
              yield* Queue.offer(queue, { _tag: "tick" });
            }
            yield* Queue.offer(queue, { _tag: "end" });
            yield* Effect.log("End event sent");
          }).pipe(Effect.ensuring(Queue.end(queue))),
        );
        return queue;
      }),

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

const PresenceRpcLive = WebSocketRpc.toLayer(
  Effect.gen(function* () {
    const presence = yield* PresenceService;
    yield* Effect.log("Starting Presence RPC Live Implementation");

    return {
      subscribe: Effect.fn(function* () {
        yield* Effect.log("New presence subscription");

        const clientId = presence.generateClientId();
        const connectedAt = Date.now();
        const clientInfo: ClientInfo = {
          clientId,
          status: "online",
          connectedAt,
        };

        const queue = yield* Queue.make<WebSocketEvent, Cause.Done>();

        // CRITICAL: Subscribe to PubSub FIRST to ensure we don't miss any events
        const subscription = yield* presence.subscribe();

        // Fork the stream consumer to handle incoming PubSub events
        yield* Effect.forkScoped(
          Stream.fromSubscription(subscription).pipe(
            Stream.tap((event) =>
              Effect.gen(function* () {
                // Filter out our own user_joined event since we send "connected" instead
                if (
                  event._tag === "user_joined" &&
                  event.client.clientId === clientId
                ) {
                  return;
                }
                yield* Queue.offer(queue, event);
              }),
            ),
            Stream.runDrain,
            Effect.ensuring(
              Effect.gen(function* () {
                yield* presence.removeClient(clientId);
                yield* Queue.end(queue);
                yield* Effect.log(
                  `Presence subscription ended for ${clientId}`,
                );
              }),
            ),
          ),
        );

        // Get existing clients BEFORE adding ourselves
        const existingClients = yield* presence.getClients();

        // Now add ourselves - this publishes user_joined to PubSub for other clients
        yield* presence.addClient(clientId, clientInfo);

        // Send our own connected event (not user_joined since we're the one connecting)
        yield* Queue.offer(queue, {
          _tag: "connected",
          clientId,
          connectedAt,
        });

        // Send existing clients as user_joined events so we know who's already here
        for (const client of existingClients) {
          yield* Queue.offer(queue, {
            _tag: "user_joined",
            client,
          });
        }

        return queue;
      }),

      setStatus: Effect.fn(function* (payload) {
        yield* Effect.log(
          `Setting status for ${payload.clientId} to ${payload.status}`,
        );
        yield* presence.setStatus(payload.clientId, payload.status);
        return { success: true };
      }),

      getPresence: Effect.fn(function* () {
        const clients = yield* presence.getClients();
        yield* Effect.log(`Returning ${clients.length} clients`);
        return { clients: [...clients] };
      }),
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
  Layer.provide(Layer.merge(HealthGroupLive, HelloGroupLive)),
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

// WebSocket RPC Router (for PresenceRpc - real-time presence)
const WebSocketRpcRouter = RpcServer.layerHttp({
  group: WebSocketRpc,
  path: "/ws",
  protocol: "websocket", // Use WebSocket for PresenceRpc!
  spanPrefix: "ws",
  disableFatalDefects: true,
}).pipe(
  Layer.provide(PresenceRpcLive),
  Layer.provide(Layer.effect(PresenceService)(PresenceService.make)),
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

  const AllRouters = Layer.mergeAll(
    ApiRouter,
    HttpRpcRouter,
    WebSocketRpcRouter,
  ).pipe(
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
}).pipe(Layer.unwrap, Layer.launch) as Effect.Effect<
  never,
  Config.ConfigError,
  never
>;

BunRuntime.runMain(HttpLive);
