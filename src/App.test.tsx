import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders native heading", () => {
  render(<App />);
  const heading = screen.getByRole("heading", { name: /native/i });
  expect(heading).toBeInTheDocument();
});
