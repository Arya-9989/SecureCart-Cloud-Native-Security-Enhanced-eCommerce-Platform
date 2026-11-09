import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { expect, it, vi } from "vitest";

import { TextField } from "./Field";
import { Button } from "./Button";
import { QuantityStepper } from "./misc";

it("disables a loading button even when explicitly enabled and forwards its ref", async () => {
  const ref = createRef<HTMLButtonElement>();
  const onClick = vi.fn();
  render(
    <Button ref={ref} loading disabled={false} onClick={onClick}>
      Save
    </Button>,
  );
  const button = screen.getByRole("button", { name: "Save" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(ref.current).toBe(button);
  await userEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});

it("keeps quantity within its limits when explicitly enabled", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(
    <QuantityStepper label="Quantity" value={1} max={3} disabled={false} onChange={onChange} />,
  );
  expect(screen.getByRole("button", { name: "Decrease quantity" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Increase quantity" }));
  expect(onChange).toHaveBeenCalledWith(2);
  rerender(
    <QuantityStepper label="Quantity" value={3} max={3} disabled={false} onChange={onChange} />,
  );
  expect(screen.getByRole("button", { name: "Increase quantity" })).toBeDisabled();
  rerender(<QuantityStepper label="Quantity" value={2} max={3} disabled onChange={onChange} />);
  expect(screen.getByRole("button", { name: "Decrease quantity" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Increase quantity" })).toBeDisabled();
});

it("announces field errors in a persistent live region", () => {
  const { container, rerender } = render(<TextField label="Email" />);
  const live = container.querySelector('[aria-live="polite"]');
  expect(live).toBeInTheDocument();
  expect(live).toBeEmptyDOMElement();
  rerender(<TextField label="Email" error="Enter a valid email address" />);
  expect(container.querySelector('[aria-live="polite"]')).toBe(live);
  expect(live).toHaveTextContent("Enter a valid email address");
  expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Enter a valid email address");
});
