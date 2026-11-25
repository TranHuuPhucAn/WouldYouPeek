import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AuthChallenge } from "@/components/auth/AuthChallenge";
import { AuthForm } from "@/components/auth/AuthForm";
import { loadTurnstile, type TurnstileOptions } from "@/lib/auth/turnstile";

vi.mock("@/lib/auth/turnstile", () => ({ loadTurnstile: vi.fn() }));
let options: TurnstileOptions;
const provider = {
  render: vi.fn((_node: HTMLElement, value: TurnstileOptions) => {
    options = value;
    return "widget";
  }),
  remove: vi.fn(),
};
beforeEach(() => {
  vi.mocked(loadTurnstile).mockReset().mockResolvedValue(provider);
});

it("reports success, clears expired tokens, retries and ignores callbacks after unmount", async () => {
  const token = vi.fn();
  const view = render(
    <AuthChallenge siteKey="public-key" onToken={token} resetKey={0} />,
  );
  await waitFor(() => expect(provider.render).toHaveBeenCalledOnce());
  expect(options["response-field"]).toBe(false);
  expect(options.size).toBe("compact");
  act(() => options.callback("solved-token"));
  expect(token).toHaveBeenLastCalledWith("solved-token");
  expect(screen.getByRole("status")).toHaveTextContent("complete");
  act(() => options["expired-callback"]());
  expect(token).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByRole("button", { name: "Retry security check" }));
  await waitFor(() => expect(provider.render).toHaveBeenCalledTimes(2));
  const callback = options.callback;
  view.unmount();
  expect(provider.remove).toHaveBeenCalledTimes(2);
  token.mockClear();
  callback("late-token");
  expect(token).not.toHaveBeenCalled();
});

it("offers visible recovery when the provider script is blocked", async () => {
  vi.mocked(loadTurnstile).mockRejectedValueOnce(new Error("blocked"));
  render(<AuthChallenge siteKey="public-key" onToken={vi.fn()} resetKey={0} />);
  expect(
    await screen.findByRole("button", { name: "Retry security check" }),
  ).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("connection");
  fireEvent.click(screen.getByRole("button", { name: "Retry security check" }));
  await waitFor(() => expect(provider.render).toHaveBeenCalledOnce());
});

it("does not mount a widget after its form unmounts during script loading", async () => {
  let resolve!: (value: typeof provider) => void;
  vi.mocked(loadTurnstile).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(
    <AuthChallenge siteKey="public-key" onToken={vi.fn()} resetKey={0} />,
  );
  view.unmount();
  await act(async () => resolve(provider));
  expect(provider.render).not.toHaveBeenCalled();
});

it("captures a solved token in the request, prevents duplicate submission, then requires a fresh token", async () => {
  let finish!: (result: { status: "error"; message: string }) => void;
  const action = vi.fn(
    (_state, _data: FormData) =>
      new Promise<{ status: "error"; message: string }>((r) => {
        finish = r;
      }),
  );
  render(
    <AuthForm
      action={action}
      fields={["email"]}
      label="Continue"
      challenge={{ kind: "turnstile", siteKey: "public-key" }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "learner@example.test" },
  });
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  await waitFor(() => expect(provider.render).toHaveBeenCalledOnce());
  act(() => options.callback("fresh-token"));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect(action.mock.calls[0][1].get("captchaToken")).toBe("fresh-token");
  expect(screen.getByRole("button", { name: "Please wait…" })).toBeDisabled();
  await act(async () =>
    finish({ status: "error", message: "Please try again later." }),
  );
  await waitFor(() => expect(provider.render).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  expect(screen.getByLabelText("Email")).toHaveValue("learner@example.test");
  expect(screen.queryByText(/Try again in/)).not.toBeInTheDocument();
  act(() => options.callback("second-token"));
  expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
});

it("keeps local forms independent of the external challenge service", () => {
  render(
    <AuthForm
      action={vi.fn()}
      fields={["email"]}
      label="Continue"
      challenge={{ kind: "none" }}
    />,
  );
  expect(loadTurnstile).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
});
