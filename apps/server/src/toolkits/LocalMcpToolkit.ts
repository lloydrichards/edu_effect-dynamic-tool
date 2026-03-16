import { Config, Effect, Layer, ServiceMap } from "effect";
import { createMcpToolkit } from "./McpToolkit";

export class LocalMcpToolkit extends ServiceMap.Service<LocalMcpToolkit>()(
  "LocalMcpToolkit",
  {
    make: Effect.gen(function* () {
      const url = yield* Config.string("LOCAL_MCP_URL").pipe(
        Config.withDefault("http://localhost:9009/mcp"),
      );

      return yield* createMcpToolkit({
        url,
        namePrefix: "localMcp_",
      });
    }),
  },
) {}

export const LocalMcpToolkitLive = Layer.effect(LocalMcpToolkit)(
  LocalMcpToolkit.make,
);
