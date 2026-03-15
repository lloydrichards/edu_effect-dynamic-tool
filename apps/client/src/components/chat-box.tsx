import { useAtom } from "@effect/atom-react";
import type { ChatResponse, MessageSegment } from "@repo/domain/Chat";
import type { NoSuchElementError } from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { AlertCircle, Loader2, Send } from "lucide-react";
import { type FC, useEffect, useMemo, useRef, useState } from "react";
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastSentMessagesRef = useRef<
    Array<{
      role: "user" | "assistant" | "system";
      content: string;
    }>
  >([]);
  const readinessAttemptRef = useRef(0);

  const currentResult: ChatResponse = AsyncResult.getOrElse(
    result,
    () => ({ _tag: "initial" }) as const,
  );

  const currentSegments =
    currentResult._tag === "initial" ? [] : currentResult.segments;

  const isWaiting = AsyncResult.isWaiting(result);
  const isFailure = AsyncResult.isFailure(result);
  const isStreaming = currentResult._tag === "streaming";
  const sendMessages = (
    messages: Array<{
      role: "user" | "assistant" | "system";
      content: string;
    }>,
  ) => {
    lastSentMessagesRef.current = messages;
    readinessAttemptRef.current = 0;
    runChat(messages);
  };

  useEffect(() => {
    if (!isFailure) return;
    if (currentResult._tag !== "error" || !currentResult.error.recoverable) {
      return;
    }
    if (lastSentMessagesRef.current.length === 0) return;
    if (readinessAttemptRef.current >= 3) return;

    readinessAttemptRef.current += 1;
    const timeoutId = window.setTimeout(() => {
      runChat(lastSentMessagesRef.current);
    }, 600 * readinessAttemptRef.current);

    return () => window.clearTimeout(timeoutId);
  }, [currentResult, isFailure, runChat]);

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg: Message = { role: "user", message: input };
    setHistory((prev) => [...prev, userMsg]);
    setInput("");

    const messages = historyToMessages([...history, userMsg]);
    sendMessages(messages);
  };

  const currentIteration =
    currentResult._tag === "streaming" ? currentResult.currentIteration : null;

  const streamingMessage = useMemo<Message | null>(() => {
    if (currentResult._tag !== "streaming") return null;
    if (currentSegments.length === 0) return null;
    return {
      role: "assistant",
      message: "",
      segments: currentSegments,
    };
  }, [currentResult._tag, currentSegments]);

  const displayHistory = useMemo(() => {
    if (!streamingMessage) return history;
    return [...history, streamingMessage];
  }, [history, streamingMessage]);

  const scrollTrigger = useMemo(
    () => `${displayHistory.length}-${currentSegments.length}`,
    [displayHistory.length, currentSegments.length],
  );

  const completionSnapshot = useMemo(() => {
    if (currentResult._tag !== "complete") return null;
    if (currentResult.segments.length === 0) return null;
    return {
      segments: currentResult.segments,
      usage: currentResult.usage,
      finishReason: currentResult.finishReason,
    };
  }, [currentResult]);

  useEffect(() => {
    if (!completionSnapshot) return;
    setHistory((prev) => [
      ...prev,
      {
        role: "assistant",
        message: "",
        segments: completionSnapshot.segments,
        usage: completionSnapshot.usage,
        finishReason: completionSnapshot.finishReason,
      },
    ]);
  }, [completionSnapshot]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollTrigger is stable string
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: isStreaming ? "auto" : "smooth",
    });
  }, [scrollTrigger]);

  return (
    <div className="flex min-h-[60vh] w-full flex-col border border-foreground/30 bg-card text-card-foreground lg:min-h-[70vh]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-foreground/30 px-6 py-4">
        <h2 className="font-display text-2xl uppercase tracking-[0.18em]">
          Chat
        </h2>
        <div className="flex gap-2">
          {isStreaming && (
            <span className="inline-flex items-center gap-1 border border-foreground/40 bg-secondary px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.2em] text-secondary-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Streaming
            </span>
          )}
          {isWaiting && !isStreaming && (
            <span className="inline-flex items-center gap-1 border border-foreground/40 px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.2em]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading
            </span>
          )}
          {isFailure && (
            <span className="inline-flex items-center gap-1 border border-destructive/60 bg-destructive/10 px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.2em] text-destructive">
              <AlertCircle className="h-3 w-3" />
              Error
            </span>
          )}
          {currentIteration !== null && (
            <span className="inline-flex items-center gap-1 border border-foreground/40 bg-secondary px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.2em] text-secondary-foreground">
              Iteration {currentIteration}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-6"
        ref={scrollContainerRef}
      >
        <div className="space-y-6 py-6">
          {/* Empty state */}
          {displayHistory.length === 0 && currentSegments.length === 0 && (
            <div className="flex flex-col items-start gap-3 border border-foreground/30 bg-secondary/40 px-4 py-6 text-foreground/80">
              <p className="text-sm uppercase tracking-[0.28em] text-foreground/60">
                Empty channel
              </p>
              <p className="text-sm leading-relaxed">
                Start with a clear request.
              </p>
            </div>
          )}

          {/* History messages */}
          {displayHistory.map((msg, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: stable order in append-only history
              key={i}
              className={cn(
                "flex w-full flex-col gap-2",
                msg.role === "user" ? "items-end mb-8" : "items-start",
              )}
            >
              {msg.role === "user" ? (
                <div className="border border-foreground/60 bg-primary px-4 py-2 text-sm text-primary-foreground whitespace-break-spaces">
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

          {/* Thinking message */}
          {currentResult._tag === "streaming" && currentResult.thinking && (
            <div className="flex w-full flex-col gap-2 items-start">
              <div className="border border-foreground/30 px-2 py-1 text-[0.65rem] uppercase tracking-[0.2em] text-foreground/60">
                Thinking: {currentResult.thinking}
              </div>
            </div>
          )}

          {/* Error display from stream */}
          {currentResult._tag === "error" && (
            <div className="text-destructive text-sm p-3 border border-destructive/60 bg-destructive/10">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">{currentResult.error.message}</p>
                  {currentResult.error.recoverable && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const messages = historyToMessages(history);
                        sendMessages(messages);
                      }}
                      className="mt-2 uppercase tracking-[0.2em] text-[0.65rem]"
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
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-foreground/30 px-6 py-4">
        <div className="flex w-full gap-2">
          <input
            type="text"
            className="flex-1 border border-foreground/40 bg-background px-3 py-2 text-sm placeholder:text-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            placeholder="Send a message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            disabled={isWaiting || isStreaming}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || isWaiting || isStreaming}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

const historyToMessages = (messages: Message[]) =>
  messages.map((msg) => {
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

const ErrorDisplay: FC<{
  result: AsyncResult.Failure<ChatResponse, NoSuchElementError>;
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
