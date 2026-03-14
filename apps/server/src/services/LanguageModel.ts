import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { FetchHttpClient } from "@effect/platform";
import { Config, Layer } from "effect";

const AnthropicClientLive = AnthropicClient.layerConfig({
  apiKey: Config.redacted("ANTHROPIC_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

export const AnthropicModelLive = AnthropicLanguageModel.layer({
  model: "claude-sonnet-4-5",
}).pipe(Layer.provide(AnthropicClientLive));
