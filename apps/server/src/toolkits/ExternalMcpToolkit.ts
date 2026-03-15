import { Effect, Layer, Ref, ServiceMap } from "effect";
import { createMcpToolkit, type McpToolkitBundle } from "./McpToolkit";

export class ExternalMcpToolkit extends ServiceMap.Service<ExternalMcpToolkit>()(
  "ExternalMcpToolkit",
  {
    make: Effect.gen(function* () {
      const ref = yield* Ref.make<McpToolkitBundle | null>(null);

      const refresh = () =>
        Effect.gen(function* () {
          const bundle = yield* createMcpToolkit({
            url: "https://remote.mcpservers.org/fetch/mcp",
            namePrefix: "externalMcp_",
          });
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
    }),
  },
) {}

export const ExternalMcpToolkitLive = Layer.effect(ExternalMcpToolkit)(
  ExternalMcpToolkit.make,
);
