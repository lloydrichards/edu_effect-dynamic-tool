import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import App from "./app";

// Mock the atom hooks (v4: @effect/atom-react)
vi.mock("@effect/atom-react", () => ({
  useAtom: vi.fn(() => [{ _tag: "Initial" }, vi.fn()]),
  useAtomSet: vi.fn(() => vi.fn()),
}));

// Mock AsyncResult from effect/unstable/reactivity
vi.mock("effect/unstable/reactivity", () => ({
  AsyncResult: {
    getOrElse: vi.fn((_result: unknown, fallback: () => unknown) => {
      return fallback();
    }),
    builder: vi.fn(() => ({
      onSuccess: vi.fn().mockReturnThis(),
      onFailure: vi.fn().mockReturnThis(),
      onInitial: vi.fn().mockReturnThis(),
      orNull: vi.fn(() => null),
    })),
    match: vi.fn((_result: unknown, _handlers: unknown) => null),
    isSuccess: vi.fn(() => false),
    isInitial: vi.fn(() => true),
    isFailure: vi.fn(() => false),
    isWaiting: vi.fn(() => false),
  },
}));

vi.mock("./lib/atoms/chat-atom", () => ({
  chatAtom: vi.fn(),
}));

describe("App", () => {
  test("renders without crashing", async () => {
    const screen = await render(<App />);
    await expect
      .element(screen.getByText("edu_effect-dynamic-tool"))
      .toBeVisible();
  });

  test("displays the subtitle", async () => {
    const screen = await render(<App />);
    await expect
      .element(screen.getByText("A simple home for the chat prototype."))
      .toBeVisible();
  });

  test("does render the Chat section", async () => {
    const screen = await render(<App />);
    await expect
      .element(screen.getByText("Chat", { exact: true }))
      .toBeVisible();
  });
});
