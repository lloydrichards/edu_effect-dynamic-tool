import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { Config, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

const AnthropicClientLive = AnthropicClient.layerConfig({
  apiKey: Config.redacted("ANTHROPIC_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

export const AnthropicModelLive = AnthropicLanguageModel.layer({
  model: "claude-sonnet-4-5",
}).pipe(Layer.provide(AnthropicClientLive));
