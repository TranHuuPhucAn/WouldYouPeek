import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ReportDetail } from "@/components/operator/ReportDetail";
import { operatorDetail } from "./moderation-fixtures";
import { viewer } from "./session-fixtures";
import { when } from "./creator-fixtures";
vi.mock("@/components/operator/ReportMediaPreview", () => ({
  ReportMediaPreview: () => <div data-testid="media-control" />,
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
function view() {
  const detail = operatorDetail();
  render(<ReportDetail initial={detail} viewerId={viewer.id} />);
  return detail;
}
it("resolves only after a private note and retries an uncertain command with the same identity", async () => {
  const detail = operatorDetail(),
    resolved = {
      ...detail.report,
      status: "resolved",
      revision: 1,
      resolvedAt: when,
      resolution: "addressed",
      operatorNote: "Checked pinned playback.",
    };
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("lost"))
    .mockResolvedValueOnce(Response.json({ report: resolved, replayed: true }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  view();
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Resolve report" }));
  expect(screen.getByLabelText("Private operator note")).toHaveFocus();
  expect(fetcher).not.toHaveBeenCalled();
  await user.type(
    screen.getByLabelText("Private operator note"),
    "Checked pinned playback.",
  );
  await user.click(screen.getByRole("button", { name: "Resolve report" }));
  await user.click(
    await screen.findByRole("button", { name: "Retry operator action" }),
  );
  expect(await screen.findByText(/Report resolution saved/)).toBeVisible();
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  expect(screen.getByText("No operator hold")).toBeVisible();
  expect(screen.getByText(resolved.operatorNote)).toBeVisible();
});
it("requires explicit hide confirmation and keeps report resolution separate", async () => {
  const detail = operatorDetail(),
    visibility = {
      ...detail.visibility,
      hidden: true,
      revision: 1,
      reason: "Correct the pause timing.",
      changedAt: when,
    };
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ visibility, replayed: false }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  view();
  await user.click(screen.getByRole("button", { name: "Hide scenario" }));
  expect(screen.getByLabelText("Reason shared with the creator")).toHaveFocus();
  expect(fetcher).not.toHaveBeenCalled();
  await user.type(
    screen.getByLabelText("Reason shared with the creator"),
    visibility.reason,
  );
  await user.click(screen.getByRole("button", { name: "Hide scenario" }));
  expect(
    screen.getByRole("group", { name: "Confirm hiding scenario" }),
  ).toBeVisible();
  expect(screen.getByText(/editorial starter playlist needs/)).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm hide" }));
  expect(await screen.findByText("Hidden by operator")).toBeVisible();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Restore scenario" }),
    ).toHaveFocus(),
  );
  expect(screen.getByRole("button", { name: "Resolve report" })).toBeVisible();
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    expectedRevision: 0,
    hidden: true,
    reason: visibility.reason,
  });
});
it("refreshes conflicts while retaining the private note and visibility reason", async () => {
  const detail = operatorDetail(),
    newDetail = {
      ...detail,
      visibility: {
        ...detail.visibility,
        hidden: true,
        revision: 1,
        reason: "Other operator hold",
        changedAt: when,
      },
    };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        { error: { code: "VISIBILITY_CONFLICT", message: "Changed" } },
        { status: 409 },
      ),
    )
    .mockResolvedValueOnce(Response.json(newDetail));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  view();
  await user.type(
    screen.getByLabelText("Private operator note"),
    "Private draft.",
  );
  await user.type(
    screen.getByLabelText("Reason shared with the creator"),
    "Our reason.",
  );
  await user.click(screen.getByRole("button", { name: "Hide scenario" }));
  await user.click(screen.getByRole("button", { name: "Confirm hide" }));
  expect(await screen.findByText(/Your text is kept/)).toBeVisible();
  expect(screen.getByLabelText("Private operator note")).toHaveValue(
    "Private draft.",
  );
  expect(screen.getByLabelText("Reason shared with the creator")).toHaveValue(
    "Our reason.",
  );
  expect(
    screen.queryByRole("button", { name: "Confirm hide" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Restore scenario" }),
  ).toBeEnabled();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("clears private report state after revoked access and ignores late mutation success", async () => {
  let respond!: (r: Response) => void;
  const fetcher = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((r) => {
        respond = r;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup(),
    detail = view();
  await user.type(
    screen.getByLabelText("Private operator note"),
    "Operator private text",
  );
  await user.click(screen.getByRole("button", { name: "Resolve report" }));
  act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
  await act(async () =>
    respond(
      Response.json({
        report: {
          ...detail.report,
          status: "resolved",
          revision: 1,
          resolvedAt: when,
          resolution: "addressed",
          operatorNote: "Operator private text",
        },
        replayed: false,
      }),
    ),
  );
  expect(screen.getByText("Operator access changed.")).toBeVisible();
  expect(screen.queryByText(detail.report.detail)).not.toBeInTheDocument();
  expect(screen.queryByText("Operator private text")).not.toBeInTheDocument();
  expect(screen.queryByTestId("media-control")).not.toBeInTheDocument();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
it("does not imply restoring a creator-withdrawn scenario republishes it", async () => {
  const detail = operatorDetail();
  detail.visibility = {
    ...detail.visibility,
    hidden: true,
    revision: 1,
    reason: "Needs review",
    changedAt: when,
    creatorPublished: false,
  };
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      visibility: {
        ...detail.visibility,
        hidden: false,
        revision: 2,
        reason: "Fixed",
        changedAt: when,
      },
      replayed: false,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<ReportDetail initial={detail} viewerId={viewer.id} />);
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Reason shared with the creator"),
    "Fixed",
  );
  await user.click(screen.getByRole("button", { name: "Restore scenario" }));
  await user.click(screen.getByRole("button", { name: "Confirm restore" }));
  expect(
    await screen.findByText(/creator’s scenario is still unpublished/),
  ).toBeVisible();
});
it("returns keyboard focus to the visibility action after cancelling confirmation", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  view();
  await user.type(
    screen.getByLabelText("Reason shared with the creator"),
    "Review timing",
  );
  await user.click(screen.getByRole("button", { name: "Hide scenario" }));
  expect(
    screen.getByRole("heading", { name: "Hide this scenario?" }),
  ).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Hide scenario" })).toHaveFocus();
  expect(screen.getByLabelText("Reason shared with the creator")).toHaveValue(
    "Review timing",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
