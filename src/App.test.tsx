import { render, screen } from "@testing-library/react";
import App, { classifyAutoIntent, shouldTranslate } from "./App";

test("renders native heading", () => {
  render(<App />);
  const heading = screen.getByRole("heading", { name: /native/i });
  expect(heading).toBeInTheDocument();
});

test("does not render scene preset selector", () => {
  render(<App />);
  expect(screen.queryByLabelText(/scene/i)).not.toBeInTheDocument();
});

test("classifies announcement intent", () => {
  expect(classifyAutoIntent("Next station is Majestic. Please move to platform 2.")).toBe(
    "announcement",
  );
});

test("same detected language does not require translation", () => {
  expect(shouldTranslate("hi-IN", "hi-IN")).toBe(false);
  expect(shouldTranslate("kn-IN", "hi-IN")).toBe(true);
});
