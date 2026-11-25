import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ReportsPage from "@/app/operator/reports/page";
import ReportPage from "@/app/operator/reports/[reportId]/page";
import OperatorLayout from "@/app/operator/layout";
import AccountPage from "@/app/account/page";
import { requirePageAccount } from "@/app/protected-page";
import { requireOperator, hasOperatorAccess } from "@/server/auth/guards";
import {
  getOperatorReport,
  getOperatorReports,
} from "@/server/moderation/service";
import { ApiError } from "@/server/http";
import { operatorDetail, reportId } from "./moderation-fixtures";
import { viewer } from "./session-fixtures";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/app/protected-page", () => ({ requirePageAccount: vi.fn() }));
vi.mock("@/server/auth/guards", () => ({
  requireOperator: vi.fn(),
  hasOperatorAccess: vi.fn(),
}));
vi.mock("@/server/moderation/service", () => ({
  getOperatorReports: vi.fn(),
  getOperatorReport: vi.fn(),
}));
vi.mock("@/server/account/creator-profile/service", () => ({
  getCreatorProfile: vi.fn(),
}));
vi.mock("@/components/account/CreatorProfileForm", () => ({
  CreatorProfileForm: () => null,
}));
vi.mock("@/components/account/AccountPanel", () => ({
  AccountPanel: ({
    operatorAccess,
    operatorAccessUnavailable,
  }: {
    operatorAccess: boolean;
    operatorAccessUnavailable: boolean;
  }) => (
    <div>
      {operatorAccess ? "Operator entry" : "Ordinary account"}
      {operatorAccessUnavailable && " Lookup unavailable"}
    </div>
  ),
}));
vi.mock("@/components/operator/ReportQueue", () => ({
  ReportQueue: () => <div>Private report queue</div>,
}));
vi.mock("@/components/operator/ReportDetail", () => ({
  ReportDetail: () => <div>Private report detail</div>,
}));
beforeEach(() => {
  vi.mocked(requirePageAccount).mockReset().mockResolvedValue(viewer);
  vi.mocked(requireOperator).mockReset().mockResolvedValue(viewer);
  vi.mocked(hasOperatorAccess).mockReset().mockResolvedValue(false);
  vi.mocked(getOperatorReports)
    .mockReset()
    .mockResolvedValue({ reports: [], nextCursor: null });
  vi.mocked(getOperatorReport).mockReset().mockResolvedValue(operatorDetail());
});
it("checks account and membership before loading any queue or detail", async () => {
  vi.mocked(requirePageAccount).mockRejectedValue(new Error("SIGN_IN"));
  await expect(
    ReportsPage({ searchParams: Promise.resolve({}) }),
  ).rejects.toThrow("SIGN_IN");
  expect(requireOperator).not.toHaveBeenCalled();
  expect(getOperatorReports).not.toHaveBeenCalled();
  vi.mocked(requirePageAccount).mockResolvedValue(viewer);
  vi.mocked(requireOperator).mockRejectedValue(
    new ApiError("OPERATOR_REQUIRED", "No access"),
  );
  await expect(
    ReportPage({ params: Promise.resolve({ reportId }) }),
  ).rejects.toThrow("NOT_FOUND");
  await expect(OperatorLayout({ children: <div>Secret</div> })).rejects.toThrow(
    "NOT_FOUND",
  );
  expect(getOperatorReport).not.toHaveBeenCalled();
});
it("renders operator pages only after guarded reads and forwards bounded query validation to the service", async () => {
  const query = { status: "resolved", cursor: "next", limit: "10" };
  render(await ReportsPage({ searchParams: Promise.resolve(query) }));
  expect(getOperatorReports).toHaveBeenCalledWith(query);
  expect(screen.getByText("Private report queue")).toBeVisible();
  render(await ReportPage({ params: Promise.resolve({ reportId }) }));
  expect(getOperatorReport).toHaveBeenCalledWith(reportId);
  expect(screen.getByText("Private report detail")).toBeVisible();
});
it.each(["INVALID_REQUEST", "REPORT_NOT_FOUND"] as const)(
  "maps %s details to not found",
  async (code) => {
    vi.mocked(getOperatorReport).mockRejectedValue(
      new ApiError(code, "Unavailable"),
    );
    await expect(
      ReportPage({ params: Promise.resolve({ reportId }) }),
    ).rejects.toThrow("NOT_FOUND");
  },
);
it("keeps ordinary Account available when operator membership lookup fails", async () => {
  vi.mocked(hasOperatorAccess).mockRejectedValue(new Error("Outage"));
  render(await AccountPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("Ordinary account Lookup unavailable")).toBeVisible();
  expect(screen.queryByText("Operator entry")).not.toBeInTheDocument();
});
it("maps invalid queue filters or cursors to a generic unavailable page", async () => {
  vi.mocked(getOperatorReports).mockRejectedValue(
    new ApiError("INVALID_REQUEST", "Invalid query"),
  );
  await expect(
    ReportsPage({ searchParams: Promise.resolve({ status: "unknown" }) }),
  ).rejects.toThrow("NOT_FOUND");
});
