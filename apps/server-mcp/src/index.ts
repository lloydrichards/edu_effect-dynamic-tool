import * as NodeSdk from "@effect/opentelemetry/NodeSdk";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Config, Effect, Layer, Option, Schema } from "effect";
import { McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { DevTools } from "effect/unstable/devtools";
import { HttpRouter, HttpServer } from "effect/unstable/http";

// Define Resources
const ResourceLayer = Layer.mergeAll(
  McpServer.resource({
    uri: "app://primer",
    name: "Primer Document",
    description: "Documentation for the application",
    content: Effect.succeed(
      "This is a sample primer document to demonstrate MCP server capabilities.",
    ),
  }),
  // You can add more resources here
);

// Define Prompts
const PromptLayer = Layer.mergeAll(
  McpServer.prompt({
    name: "Hello Prompt",
    description: "A simple greeting prompt",
    parameters: {
      name: Schema.String,
    },
    content: ({ name }) =>
      Effect.succeed(
        `Hello, ${name}! Welcome to the MCP server demonstration.`,
      ),
  }),
  // You can add more prompts here
);

// Define Toolkit
class AiTools extends Toolkit.make(
  Tool.make("GetDadJoke", {
    description: "Get a hilarious dad joke from the ICanHazDadJoke API",
    success: Schema.String,
    failure: Schema.Never,
    parameters: Schema.Struct({
      searchTerm: Schema.String.annotate({
        description: "The search term to use to find dad jokes",
      }),
    }),
  }),
  // You can add more tools here
) {}

const ToolLayer = McpServer.toolkit(AiTools).pipe(
  Layer.provide(
    AiTools.toLayer(
      Effect.succeed({
        GetDadJoke: (params) =>
          Effect.succeed(
            `Here's a dad joke about ${params.searchTerm}: Why don't ${params.searchTerm}s ever get lost? Because they always follow the map!`,
          ),
        // add implementation for more tools here
      }),
    ),
  ),
);

// Define Live API
const McpLive = Layer.mergeAll(ResourceLayer, PromptLayer, ToolLayer);

const ServerConfig = Config.all({
  port: Config.number("MCP_PORT").pipe(Config.withDefault(9009)),
  enableDevTools: Config.boolean("DEVTOOLS").pipe(Config.withDefault(false)),
});

const TracingConfig = Config.all({
  exporterEndpoint: Config.option(Config.string("OTEL_EXPORTER_OTLP_ENDPOINT")),
  serviceName: Config.option(Config.string("OTEL_SERVICE_NAME")),
});

const McpRouter = McpServer.layerHttp({
  name: "BEVR MCP Server",
  version: "0.1.0",
  path: "/mcp",
}).pipe(
  Layer.provideMerge(McpLive),
  Layer.provide(
    HttpRouter.cors({
      allowedOrigins: ["*"],
      allowedMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "mcp-protocol-version"],
      credentials: false,
    }),
  ),
);

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

const HttpLive = HttpRouter.serve(McpRouter).pipe(
  HttpServer.withLogAddress,
  Layer.provideMerge(DevToolsLive),
  Layer.provideMerge(NodeSdkLive),
  Layer.provideMerge(BunHttpServer.layerConfig(ServerConfig)),
);

BunRuntime.runMain(
  Layer.launch(HttpLive) as Effect.Effect<never, Config.ConfigError, never>,
);
