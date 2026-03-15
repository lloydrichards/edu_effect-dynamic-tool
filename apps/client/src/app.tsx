import { ChatBox } from "./components/chat-box";

function App() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 pb-8 pt-8 sm:px-6">
        <header className="border border-foreground/30 bg-card">
          <div className="grid gap-6 px-6 py-8">
            <div className="flex flex-col gap-5">
              <h1 className="font-display text-[clamp(2.8rem,6vw,6rem)] leading-[0.9] text-foreground">
                edu_effect-dynamic-tool
              </h1>
              <p className="max-w-[42ch] text-base leading-relaxed text-foreground/80">
                A simple home for the chat prototype. Ask questions, watch the
                system respond, and see tools show up as needed.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-foreground/30 px-5 py-3 text-xs uppercase tracking-[0.32em] text-foreground/70">
            <span className="border border-foreground/30 px-2 py-1">
              Effect
            </span>
            <span className="border border-foreground/30 px-2 py-1">
              agent loop
            </span>
            <span className="border border-foreground/30 px-2 py-1">
              tool.dynamic
            </span>
          </div>
        </header>

        <section className="grid flex-1 min-h-0 gap-6">
          <div className="w-full flex-1 min-h-0">
            <ChatBox />
          </div>
          <div className="border border-foreground/30 bg-card p-6">
            <div className="flex items-center justify-between border-b border-foreground/30 pb-3 text-xs uppercase tracking-[0.28em] text-foreground/70">
              <span>Operator notes</span>
              <span className="font-mono text-[0.65rem]">ops-1</span>
            </div>
            <div className="mt-4 flex flex-col gap-4 text-sm text-foreground/80">
              <p>Chat is the main panel. Keep prompts short and direct.</p>
              <div className="border border-foreground/30 p-3 text-[0.7rem] uppercase tracking-[0.28em] text-foreground/70">
                Tip: “list tools” or “get dad joke about cats”.
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
