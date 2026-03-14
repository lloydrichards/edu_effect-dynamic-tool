import { DevTools } from "@effect/experimental";
import { FetchHttpClient, HttpApiClient } from "@effect/platform";
import { Atom } from "@effect-atom/atom-react";
import { Api } from "@repo/domain/Api";
import type { ChatResponse, ToolCall } from "@repo/domain/Chat";
import type { TickEvent } from "@repo/domain/Rpc";
import { Effect, Layer, Stream } from "effect";
import { RpcClient } from "./rpc-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:9000";
const ENABLE_DEVTOOLS = import.meta.env.VITE_ENABLE_DEVTOOLS === "true";

export const runtime = Atom.runtime(
  RpcClient.Default.pipe(
    Layer.provideMerge(ENABLE_DEVTOOLS ? DevTools.layer() : Layer.empty),
  ),
);

export const helloAtom = runtime.fn(() =>
  Effect.gen(function* () {
    const client = yield* HttpApiClient.make(Api, {
      baseUrl: SERVER_URL,
    });
    return yield* client.hello.get();
  }).pipe(Effect.provide(FetchHttpClient.layer)),
);
export const tickAtom = runtime.fn(
  ({ abort = false }: { readonly abort?: boolean }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        yield* Effect.log("Starting Tick Atom Stream");
        const rpc = yield* RpcClient;
        return rpc.client.tick({ ticks: 10 });
      }).pipe((self) => (abort ? Effect.interrupt : self)),
    ).pipe(
      Stream.catchTags({
        RpcClientError: Effect.die,
      }),
      Stream.mapAccum(
        { acc: "" },
        (
          state,
          event,
        ): readonly [
          { acc: string },
          { text: string; event: typeof TickEvent.Type },
        ] => {
          switch (event._tag) {
            case "starting": {
              const startAcc = "Start";
              return [{ acc: startAcc }, { text: startAcc, event }] as const;
            }
            case "tick": {
              const tickAcc = `${state.acc}.`;
              return [{ acc: tickAcc }, { text: tickAcc, event }] as const;
            }
            case "end": {
              const endAcc = `${state.acc} End`;
              return [{ acc: endAcc }, { text: endAcc, event }] as const;
            }
            default:
              return [state, { text: state.acc, event }] as const;
          }
        },
      ),
    ),
);

export const chatAtom = runtime.fn(
  (
    messages: Array<{
      role: "user" | "assistant" | "system";
      content: string;
    }>,
  ) => {
    return Stream.unwrap(
      Effect.gen(function* () {
        const rpc = yield* RpcClient;
        return rpc.client.chat({ messages });
      }),
    ).pipe(
      Stream.tapError((error: unknown) =>
        Effect.logError("[chatAtom] Stream error occurred:", error),
      ),
      Stream.scan(
        {
          _tag: "initial",
        },
        (state, part): ChatResponse => {
          switch (part._tag) {
            case "text-delta": {
              const currentSegments =
                state._tag === "initial" ? [] : state.segments;
              const lastSegment = currentSegments[currentSegments.length - 1];

              if (lastSegment?._tag === "text" && !lastSegment.isComplete) {
                return {
                  _tag: "streaming",
                  segments: [
                    ...currentSegments.slice(0, -1),
                    {
                      _tag: "text",
                      content: lastSegment.content + part.delta,
                      isComplete: false,
                    },
                  ],
                  thinking:
                    state._tag === "streaming" ? state.thinking : undefined,
                  currentIteration:
                    state._tag === "streaming" ? state.currentIteration : null,
                };
              }

              return {
                _tag: "streaming",
                segments: [
                  ...currentSegments,
                  {
                    _tag: "text",
                    content: part.delta,
                    isComplete: false,
                  },
                ],
                thinking:
                  state._tag === "streaming" ? state.thinking : undefined,
                currentIteration:
                  state._tag === "streaming" ? state.currentIteration : null,
              };
            }

            case "text-complete": {
              if (state._tag !== "streaming") return state;
              const currentSegments = state.segments;
              const lastSegment = currentSegments[currentSegments.length - 1];

              if (lastSegment?._tag === "text" && !lastSegment.isComplete) {
                return {
                  ...state,
                  segments: [
                    ...currentSegments.slice(0, -1),
                    {
                      ...lastSegment,
                      isComplete: true,
                    },
                  ],
                };
              }
              return state;
            }

            case "iteration-start": {
              const currentSegments =
                state._tag === "initial" ? [] : state.segments;
              return {
                _tag: "streaming",
                segments: currentSegments,
                currentIteration: part.iteration,
                thinking:
                  state._tag === "streaming" ? state.thinking : undefined,
              };
            }

            case "iteration-end": {
              if (state._tag !== "streaming") return state;
              return {
                ...state,
                currentIteration: null,
              };
            }

            case "tool-call-start": {
              const currentSegments =
                state._tag === "initial" ? [] : state.segments;
              return {
                _tag: "streaming",
                segments: [
                  ...currentSegments,
                  {
                    _tag: "tool-call",
                    tool: {
                      id: part.id,
                      name: part.name,
                      arguments: null,
                      argumentsText: "",
                      status: "proposed",
                    },
                  },
                ],
                thinking:
                  state._tag === "streaming" ? state.thinking : undefined,
                currentIteration:
                  state._tag === "streaming" ? state.currentIteration : null,
              };
            }

            case "tool-call-delta": {
              if (state._tag !== "streaming") return state;
              return {
                ...state,
                segments: state.segments.map((seg) =>
                  seg._tag === "tool-call" && seg.tool.id === part.id
                    ? {
                        ...seg,
                        tool: {
                          ...seg.tool,
                          argumentsText:
                            seg.tool.argumentsText + part.argumentsDelta,
                        },
                      }
                    : seg,
                ),
              };
            }

            case "tool-call-complete": {
              if (state._tag !== "streaming") return state;
              return {
                ...state,
                segments: state.segments.map((seg) =>
                  seg._tag === "tool-call" && seg.tool.id === part.id
                    ? {
                        ...seg,
                        tool: { ...seg.tool, arguments: part.arguments },
                      }
                    : seg,
                ),
              };
            }

            case "tool-execution-start": {
              if (state._tag !== "streaming") return state;
              return {
                ...state,
                segments: state.segments.map((seg) =>
                  seg._tag === "tool-call" && seg.tool.id === part.id
                    ? {
                        ...seg,
                        tool: {
                          ...seg.tool,
                          status: "executing" as ToolCall["status"],
                        },
                      }
                    : seg,
                ),
              };
            }

            case "tool-execution-complete": {
              if (state._tag !== "streaming") return state;
              const newStatus: ToolCall["status"] = part.success
                ? "complete"
                : "failed";
              return {
                ...state,
                segments: state.segments.map((seg) =>
                  seg._tag === "tool-call" && seg.tool.id === part.id
                    ? {
                        ...seg,
                        tool: {
                          ...seg.tool,
                          status: newStatus,
                          result: part.result,
                          success: part.success,
                        },
                      }
                    : seg,
                ),
              };
            }

            case "finish": {
              const segments = state._tag === "streaming" ? state.segments : [];
              return {
                _tag: "complete",
                segments,
                usage: part.usage,
                finishReason: part.finishReason,
              };
            }

            case "thinking": {
              const currentSegments =
                state._tag === "initial" ? [] : state.segments;
              return {
                _tag: "streaming",
                segments: currentSegments,
                thinking: part.message,
                currentIteration:
                  state._tag === "streaming" ? state.currentIteration : null,
              };
            }

            case "error": {
              console.error("[chatAtom] Chat stream error received:", part);
              const segments = state._tag === "streaming" ? state.segments : [];
              return {
                _tag: "error",
                segments,
                error: {
                  message: part.message,
                  recoverable: part.recoverable,
                },
              };
            }

            default:
              return state;
          }
        },
      ),
      Stream.drop(1),
      Stream.catchAll((error: unknown) => {
        console.error("[chatAtom] Caught unhandled stream error:", error);
        const errorMessage =
          error instanceof Error
            ? `Stream failed: ${error.message}`
            : `Stream failed: ${String(error)}`;
        return Stream.make({
          _tag: "error" as const,
          segments: [],
          error: {
            message: errorMessage,
            recoverable: false,
          },
        } as ChatResponse);
      }),
    );
  },
);
