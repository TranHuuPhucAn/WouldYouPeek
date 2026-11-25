import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ReportQueue } from "@/components/operator/ReportQueue";
import { operatorDetail } from "./moderation-fixtures";
import { viewer } from "./session-fixtures";
import { when } from "./creator-fixtures";
it("ignores stale filter responses and clears private rows on identity change", async () => {
  let respond!: (r: Response) => void;
  const open = operatorDetail().report,
    resolved = {
      ...open,
      status: "resolved",
      revision: 1,
      resolvedAt: when,
      resolution: "addressed",
      operatorNote: "Checked",
    };
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          respond = r;
        }),
    )
    .mockResolvedValueOnce(
      Response.json({ reports: [open], nextCursor: null }),
    );
  vi.stubGlobal("fetch", fetcher);
  render(
    <ReportQueue
      initial={{ reports: [open], nextCursor: null }}
      viewerId={viewer.id}
    />,
  );
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Report status"), "resolved");
  await user.selectOptions(screen.getByLabelText("Report status"), "open");
  expect(
    await screen.findByRole("link", { name: /Review report/ }),
  ).toBeVisible();
  await act(async () =>
    respond(Response.json({ reports: [resolved], nextCursor: null })),
  );
  expect(screen.getByLabelText("Report status")).toHaveValue("open");
  expect(screen.queryByText(/· resolved/)).not.toBeInTheDocument();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
  expect(screen.queryByText(open.detail)).not.toBeInTheDocument();
  expect(screen.getByText(/Operator access changed/)).toBeVisible();
});
it("retains already loaded rows when loading the next page fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const report = operatorDetail().report;
  render(
    <ReportQueue
      initial={{ reports: [report], nextCursor: "cursor" }}
      viewerId={viewer.id}
    />,
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Load more reports" }));
  expect(
    await screen.findByRole("button", { name: "Retry reports" }),
  ).toBeVisible();
  expect(screen.getByText(report.detail)).toBeVisible();
});
