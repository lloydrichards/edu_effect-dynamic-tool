import { Chat, Prompt } from "@effect/ai";
import type { ChatStreamPart } from "@repo/domain/Chat";
import { Cause, Effect, Mailbox, String } from "effect";
import { SampleToolkit } from "../toolkits/SampleToolkit";
import { runAgenticLoop } from "../workflows/agenticLoop";

export class ChatService extends Effect.Service<ChatService>()("ChatService", {
  effect: Effect.gen(function* () {
    const chat = Effect.fn("chat")(function* (history: Array<Prompt.Message>) {
      const mailbox = yield* Mailbox.make<typeof ChatStreamPart.Type>();

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

          const toolkit = yield* SampleToolkit;

          yield* runAgenticLoop({
            chat: session,
            mailbox,
            toolkit,
          });
        }).pipe(
          Effect.ensuring(mailbox.end),
          Effect.catchAllCause((cause) =>
            Effect.gen(function* () {
              yield* Effect.logError(`Chat error: ${cause}`);
              yield* mailbox.offer({
                _tag: "error",
                message: `System error: ${Cause.pretty(cause)}`,
                recoverable: false,
              });
              yield* mailbox.end;
            }),
          ),
        ),
      );

      return mailbox;
    });

    return { chat } as const;
  }),
}) {}
