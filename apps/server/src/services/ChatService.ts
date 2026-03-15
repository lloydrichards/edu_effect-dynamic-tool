import type { ChatStreamPart } from "@repo/domain/Chat";
import { Cause, Effect, Layer, Queue, ServiceMap, String } from "effect";
import { Chat, Prompt, Toolkit } from "effect/unstable/ai";
import { ExternalMcpToolkit } from "../toolkits/ExternalMcpToolkit";
import { LocalMcpToolkit } from "../toolkits/LocalMcpToolkit";
import { SampleToolkit } from "../toolkits/SampleToolkit";
import { runAgenticLoop } from "../workflows/agenticLoop";

export class ChatService extends ServiceMap.Service<ChatService>()(
  "ChatService",
  {
    make: Effect.gen(function* () {
      const chat = Effect.fn("chat")(function* (
        history: Array<Prompt.Message>,
      ) {
        const queue = yield* Queue.make<
          typeof ChatStreamPart.Type,
          Cause.Done
        >();

        yield* Effect.forkScoped(
          Effect.gen(function* () {
            const systemMessage = String.stripMargin(`
              |You are a helpful general assistant.
              |You have access to tools and should use them when appropriate.
              |Be concise and direct in your responses.
            `);

            const session = yield* Chat.fromPrompt(
              Prompt.make(history).pipe(Prompt.setSystem(systemMessage)),
            );

            const localMcpToolkit = yield* LocalMcpToolkit;
            const externalMcpToolkit = yield* ExternalMcpToolkit;

            const externalToolkit = yield* externalMcpToolkit.getToolkit();

            const activeToolkit = Toolkit.merge(
              SampleToolkit,
              localMcpToolkit.toolkit,
              externalToolkit,
            );

            const externalLayer = yield* externalMcpToolkit.getLayer();

            const toolkit = yield* Effect.fromYieldable(activeToolkit).pipe(
              Effect.provide(
                Layer.mergeAll(localMcpToolkit.layer, externalLayer),
              ),
            );

            yield* runAgenticLoop({
              chat: session,
              queue,
              toolkit,
            });
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                yield* Effect.logError(`Chat error: ${cause}`);
                yield* Queue.offer(queue, {
                  _tag: "error",
                  message: `System error: ${Cause.pretty(cause)}`,
                  recoverable: false,
                });
              }),
            ),
            Effect.ensuring(Queue.end(queue)),
          ),
        );

        return queue;
      });

      return { chat } as const;
    }),
  },
) {}
