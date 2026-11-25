import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DecisionPanel } from "@/components/challenge/DecisionPanel";
import { challenges } from "./fixtures";

const options = challenges[0].options;

it("focuses the question and permits keyboard choice without automatically submitting", async () => {
  const user = userEvent.setup(),
    submit = vi.fn(),
    select = vi.fn();
  function Harness() {
    const [choice, setChoice] = useState<string | null>(null);
    return (
      <DecisionPanel
        question="Which angle do you hold?"
        options={options}
        selectedOptionId={choice}
        pending={false}
        error={null}
        onSelect={(id) => {
          select(id);
          setChoice(id);
        }}
        onSubmit={submit}
        onReplay={vi.fn()}
      />
    );
  }
  render(<Harness />);
  expect(
    screen.getByRole("heading", { name: "Which angle do you hold?" }),
  ).toHaveFocus();
  expect(
    screen.getByRole("button", { name: /Lock in your call/ }),
  ).toBeDisabled();
  await user.click(screen.getByRole("radio", { name: "Hold the angle" }));
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("radio", { name: "Move to cover" })).toBeChecked();
  expect(select).toHaveBeenLastCalledWith("move");
  expect(submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Lock in your call/ }));
  expect(submit).toHaveBeenCalledTimes(1);
});

it("retains a selected call while replay is requested and disables commands during saving", async () => {
  const user = userEvent.setup(),
    submit = vi.fn(),
    replay = vi.fn(),
    select = vi.fn();
  const props = {
    options,
    selectedOptionId: "move",
    pending: false,
    error: null,
    onSelect: select,
    onSubmit: submit,
    onReplay: replay,
  };
  const { rerender } = render(<DecisionPanel {...props} />);
  await user.click(screen.getByRole("button", { name: /Replay setup/ }));
  expect(replay).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("radio", { name: "Move to cover" })).toBeChecked();
  expect(submit).not.toHaveBeenCalled();
  rerender(<DecisionPanel {...props} pending />);
  for (const radio of screen.getAllByRole("radio"))
    expect(radio).toBeDisabled();
  expect(screen.getByRole("button", { name: /Replay setup/ })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: /Submitting|Saving/ }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /Submitting|Saving/ }));
  expect(submit).not.toHaveBeenCalled();
});

it("announces a failed save while leaving the confirmed selection available for retry", () => {
  render(
    <DecisionPanel
      options={options}
      selectedOptionId="hold"
      pending={false}
      error="Your choice could not be saved. Retry."
      onSelect={vi.fn()}
      onSubmit={vi.fn()}
      onReplay={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Your choice could not be saved. Retry.",
  );
  expect(screen.getByRole("radio", { name: "Hold the angle" })).toBeChecked();
  expect(
    screen.getByRole("button", { name: /Lock in your call/ }),
  ).toBeEnabled();
});
