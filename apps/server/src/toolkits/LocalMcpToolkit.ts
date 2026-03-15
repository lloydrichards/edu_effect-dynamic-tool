import { Layer, ServiceMap } from "effect";
import { createMcpToolkit } from "./McpToolkit";

export class LocalMcpToolkit extends ServiceMap.Service<LocalMcpToolkit>()(
  "LocalMcpToolkit",
  {
    make: createMcpToolkit({
      url: "http://localhost:9009/mcp",
      namePrefix: "localMcp_",
    }),
  },
) {}

export const LocalMcpToolkitLive = Layer.effect(LocalMcpToolkit)(
  LocalMcpToolkit.make,
);
