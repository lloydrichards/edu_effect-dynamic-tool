import { Effect, Layer, Ref, ServiceMap } from "effect";
import type { McpClientError, McpClientOptions } from "../services/McpClient";
import { createMcpToolkit, type McpToolkitBundle } from "./McpToolkit";

export type McpToolkitServiceShape = {
  readonly getToolkit: () => Effect.Effect<McpToolkitBundle["toolkit"], never>;
  readonly getLayer: () => Effect.Effect<McpToolkitBundle["layer"], never>;
  readonly getSession: () => Effect.Effect<McpToolkitBundle["session"], never>;
  readonly getTools: () => Effect.Effect<McpToolkitBundle["tools"], never>;
  readonly refresh: () => Effect.Effect<void, McpClientError>;
};

export class LocalMcpToolkit extends ServiceMap.Service<
  LocalMcpToolkit,
  McpToolkitServiceShape
>()("LocalMcpToolkit") {}

export class ExternalMcpToolkit extends ServiceMap.Service<
  ExternalMcpToolkit,
  McpToolkitServiceShape
>()("ExternalMcpToolkit") {}

const makeServiceLayer = (
  options: McpClientOptions & { readonly namePrefix?: string },
) =>
  Effect.gen(function* () {
    const ref = yield* Ref.make<McpToolkitBundle | null>(null);

    const refresh = () =>
      Effect.gen(function* () {
        const bundle = yield* createMcpToolkit(options);
        yield* Ref.set(ref, bundle);
      });

    const requireBundle = () =>
      Ref.get(ref).pipe(
        Effect.flatMap((bundle) =>
          bundle
            ? Effect.succeed(bundle)
            : Effect.die("MCP toolkit not initialized"),
        ),
      );

    yield* refresh();

    return {
      getToolkit: () => requireBundle().pipe(Effect.map((b) => b.toolkit)),
      getLayer: () => requireBundle().pipe(Effect.map((b) => b.layer)),
      getSession: () => requireBundle().pipe(Effect.map((b) => b.session)),
      getTools: () => requireBundle().pipe(Effect.map((b) => b.tools)),
      refresh,
    } as const;
  });

export const LocalMcpToolkitLive = Layer.effect(LocalMcpToolkit)(
  makeServiceLayer({
    url: "http://localhost:9009/mcp",
    namePrefix: "localMcp_",
  }),
);

export const ExternalMcpToolkitLive = Layer.effect(ExternalMcpToolkit)(
  makeServiceLayer({
    url: "https://remote.mcpservers.org/fetch/mcp",
    namePrefix: "externalMcp_",
  }),
);
