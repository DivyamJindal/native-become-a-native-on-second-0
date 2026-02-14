import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders awaaz heading", () => {
  render(<App />);
  const heading = screen.getByRole("heading", { name: /awaaz/i });
  expect(heading).toBeInTheDocument();
});
