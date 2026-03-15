import bun from "./assets/bun.svg";
import effect from "./assets/effect.svg";
import react from "./assets/react.svg";
import vite from "./assets/vite.svg";
import { ChatBox } from "./components/chat-box";

function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col items-center gap-8 p-4">
      <div className="flex items-center gap-6 pt-8">
        <img alt="Bun logo" height={64} src={bun} width={64} />
        <img alt="Effect logo" height={64} src={effect} width={64} />
        <img alt="Vite logo" height={64} src={vite} width={64} />
        <img alt="React logo" height={64} src={react} width={64} />
      </div>

      <div className="text-center">
        <h1 className="font-black text-5xl">bEvr</h1>
        <h2 className="font-bold text-2xl">Bun + Effect + Vite + React</h2>
        <p className="text-gray-600">A typesafe fullstack monorepo</p>
      </div>

      {/* Chat */}
      <div className="w-full max-w-3xl h-[600px]">
        <ChatBox />
      </div>
    </div>
  );
}

export default App;
