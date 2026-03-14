import { Result, useAtom } from "@effect-atom/atom-react";
import type { ChatResponse, MessageSegment } from "@repo/domain/Chat";
import type { NoSuchElementException } from "effect/Cause";
import { AlertCircle, Loader2, Send } from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import { chatAtom } from "@/lib/atoms/chat-atom";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Markdown } from "./ui/markdown";
import { Segment, TokenUsage, ToolCall } from "./ui/segment";

type Message = {
  role: "user" | "assistant" | "system";
  message: string;
  segments?: readonly MessageSegment[];
  usage?:
    | {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      }
    | undefined;
  finishReason?: string | undefined;
};

export function ChatBox() {
  const [result, runChat] = useAtom(chatAtom);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Message[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intended
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, result]);

  const appendResultToHistory = (
    currentHistory: Message[],
    currentResult: typeof result,
  ) => {
    const nextHistory = [...currentHistory];
    if (Result.isSuccess(currentResult)) {
      const response = currentResult.value;
      if (response._tag === "complete") {
        const assistantMsg: Message = {
          role: "assistant",
          message: "",
          segments: response.segments,
          usage: response.usage,
          finishReason: response.finishReason,
        };
        nextHistory.push(assistantMsg);
      } else if (response._tag === "streaming") {
        const assistantMsg: Message = {
          role: "assistant",
          message: "",
          segments: response.segments,
        };
        nextHistory.push(assistantMsg);
      }
    }
    return nextHistory;
  };

  const handleSend = () => {
    if (!input.trim()) return;

    // If there was a previous successful response, add it to history
    const newHistory = appendResultToHistory(history, result);

    const userMsg: Message = { role: "user", message: input };
    newHistory.push(userMsg);

    setHistory(newHistory);
    setInput("");

    // Send full message history to server for context
    const messages = newHistory.map((msg) => {
      if (msg.role === "assistant" && msg.segments) {
        const textContent = msg.segments
          .filter((seg) => seg._tag === "text")
          .map((seg) => seg.content)
          .join("");
        return {
          role: msg.role,
          content: textContent || msg.message,
        };
      }
      return {
        role: msg.role,
        content: msg.message,
      };
    });
    runChat(messages);
  };

  // Extract current streaming response
  const currentResult: ChatResponse = Result.getOrElse(
    result,
    () => ({ _tag: "initial" }) as const,
  );
  const currentSegments =
    currentResult._tag === "initial" ? [] : currentResult.segments;
  const currentIteration =
    currentResult._tag === "streaming" ? currentResult.currentIteration : null;

  // Determine RPC status for display
  const isWaiting = Result.isWaiting(result);
  const isFailure = Result.isFailure(result);
  const isStreaming = currentResult._tag === "streaming";

  return (
    <div className="flex h-full w-full flex-col rounded-xl border bg-card text-card-foreground shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h2 className="font-semibold text-lg">Chat</h2>
        <div className="flex gap-2">
          {isStreaming && (
            <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Streaming
            </span>
          )}
          {isWaiting && !isStreaming && (
            <span className="inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-medium">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading
            </span>
          )}
          {isFailure && (
            <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
              <AlertCircle className="h-3 w-3" />
              Error
            </span>
          )}
          {currentIteration !== null && (
            <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
              Iteration {currentIteration}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6">
        <div className="space-y-4 py-4">
          {/* Empty state */}
          {history.length === 0 && currentSegments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">
                Send a message to start chatting. Try asking to calculate
                something or what time it is.
              </p>
            </div>
          )}

          {/* History messages */}
          {history.map((msg, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: stable order in append-only history
              key={i}
              className={cn(
                "flex w-full flex-col gap-2",
                msg.role === "user" ? "items-end mb-8" : "items-start",
              )}
            >
              {msg.role === "user" ? (
                <div className="rounded-lg px-4 py-2 text-sm bg-primary text-primary-foreground whitespace-break-spaces">
                  {msg.message}
                </div>
              ) : (
                <>
                  {msg.segments?.map((segment, segIdx) => (
                    <Segment
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable order
                      key={segIdx}
                    >
                      {segment._tag === "text" ? (
                        <div className="w-full py-2 text-sm">
                          <Markdown content={segment.content} />
                        </div>
                      ) : (
                        <ToolCall segment={segment} />
                      )}
                    </Segment>
                  ))}
                  {msg.usage && msg.finishReason && (
                    <TokenUsage
                      response={{
                        usage: msg.usage,
                        finishReason: msg.finishReason,
                      }}
                    />
                  )}
                </>
              )}
            </div>
          ))}

          {/* Current streaming response segments */}
          {currentSegments.length > 0 && (
            <div className="flex flex-col gap-2 items-start">
              {currentSegments.map((segment: MessageSegment, idx: number) => {
                const segmentKey =
                  segment._tag === "tool-call"
                    ? `tool-${segment.tool.id}`
                    : `text-${idx}-${segment.content.slice(0, 50)}`;

                return (
                  <Segment key={segmentKey}>
                    {segment._tag === "text" ? (
                      <div className="w-full py-2 text-sm">
                        <Markdown content={segment.content} />
                      </div>
                    ) : (
                      <ToolCall segment={segment} />
                    )}
                  </Segment>
                );
              })}
              {Result.isSuccess(result) &&
                currentResult._tag === "complete" && (
                  <TokenUsage response={currentResult} />
                )}
            </div>
          )}

          {/* Thinking message */}
          {currentResult._tag === "streaming" && currentResult.thinking && (
            <div className="flex w-full flex-col gap-2 items-start">
              <div className="text-xs text-muted-foreground px-1">
                Thinking: {currentResult.thinking}
              </div>
            </div>
          )}

          {/* Error display from stream */}
          {currentResult._tag === "error" && (
            <div className="text-destructive text-sm p-3 rounded bg-destructive/10 border border-destructive/30">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">{currentResult.error.message}</p>
                  {currentResult.error.recoverable && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const messages = history.map((msg) => ({
                          role: msg.role,
                          content: msg.message,
                        }));
                        runChat(messages);
                      }}
                      className="mt-2"
                    >
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* RPC failure display */}
          {isFailure && <ErrorDisplay result={result} />}

          {/* Scroll anchor */}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t px-6 py-4">
        <div className="flex w-full gap-2">
          <input
            type="text"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            placeholder="Send a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            disabled={isWaiting}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || isWaiting}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

const ErrorDisplay: FC<{
  result: Result.Failure<ChatResponse, NoSuchElementException>;
}> = ({ result }) => {
  return (
    <div className="flex w-full justify-center">
      <div className="text-destructive text-sm flex flex-col items-center gap-2 max-w-[80%]">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Failed to get response
        </div>
        <div className="text-xs text-muted-foreground">
          Check browser console for detailed error information
        </div>
        <details className="text-xs font-mono w-full">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Show technical details
          </summary>
          <div className="mt-2 p-2 bg-muted rounded text-left overflow-auto max-h-40">
            <pre className="whitespace-pre-wrap break-words">
              {JSON.stringify(result.cause, null, 2)}
            </pre>
          </div>
        </details>
      </div>
    </div>
  );
};
