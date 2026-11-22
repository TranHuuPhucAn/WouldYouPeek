"use client";
import { useEffect, useRef, useState } from "react";
import type {
  ReportCategory,
  ReportTarget,
  ReportReceipt,
  SubmitReportRequest,
} from "@/contracts/moderation";
import type { LibraryScenarioPreview } from "@/contracts/library";
import { submitScenarioReport } from "@/lib/client/moderation-api";
import { getLibraryScenario } from "@/lib/client/library-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";

export function useScenarioReport(
  viewerId: string | null,
  onPublicationRefreshed?: (value: LibraryScenarioPreview) => void,
) {
  const [open, setOpen] = useState(false),
    [target, setTarget] = useState<ReportTarget | null>(null);
  const [category, setCategory] = useState<ReportCategory>("broken_video"),
    [detail, setDetail] = useState("");
  const [pending, setPending] = useState(false),
    [unresolved, setUnresolved] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReportReceipt | null>(null),
    [changed, setChanged] = useState(false);
  const [latest, setLatest] = useState<LibraryScenarioPreview | null>(null),
    [invalid, setInvalid] = useState(false);
  const request = useRef<AbortController | null>(null),
    command = useRef<SubmitReportRequest | null>(null),
    valid = useRef(true),
    owner = useRef(viewerId);
  const refreshCallback = useRef(onPublicationRefreshed);
  refreshCallback.current = onPublicationRefreshed;
  useEffect(() => {
    valid.current = true;
    const invalidate = () => {
      valid.current = false;
      request.current?.abort();
      command.current = null;
      setOpen(false);
      setTarget(null);
      setDetail("");
      setReceipt(null);
      setLatest(null);
      setInvalid(true);
      setPending(false);
      setUnresolved(false);
      setError(null);
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    if (owner.current !== viewerId) invalidate();
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, [viewerId]);
  function authFailure(error: unknown) {
    if (error instanceof ApiClientError && [401, 403].includes(error.status)) {
      invalidateAccountView();
      return true;
    }
    return false;
  }
  function begin(next: ReportTarget) {
    if (!valid.current || !viewerId) return;
    if (command.current) {
      setOpen(true);
      return;
    }
    if (JSON.stringify(next) !== JSON.stringify(target)) {
      setTarget(next);
      setCategory("broken_video");
      setDetail("");
      setReceipt(null);
      setError(null);
      setChanged(false);
      setLatest(null);
    }
    setOpen(true);
  }
  async function execute(input: SubmitReportRequest) {
    if (request.current || !valid.current) return;
    const controller = new AbortController();
    request.current = controller;
    command.current = input;
    setPending(true);
    setError(null);
    try {
      const result = await submitScenarioReport(input, controller.signal);
      if (controller.signal.aborted || !valid.current) return;
      setReceipt(result);
      command.current = null;
      setUnresolved(false);
    } catch (error) {
      if (controller.signal.aborted || !valid.current || authFailure(error))
        return;
      const rejected =
        error instanceof ApiClientError &&
        error.status >= 400 &&
        error.status < 500;
      if (rejected) command.current = null;
      setUnresolved(!rejected);
      if (
        error instanceof ApiClientError &&
        error.code === "REPORT_TARGET_CHANGED"
      ) {
        setChanged(true);
        setLatest(null);
        setError(
          "This scenario has changed. Check the latest version before reporting it. Your text is kept.",
        );
      } else
        setError(
          error instanceof ApiClientError && error.code === "RATE_LIMITED"
            ? "You’ve reached the report limit. Please try again later. Your text is kept."
            : rejected
              ? (error as ApiClientError).message
              : "We couldn’t confirm your report. Retry to recover the same submission.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  async function submit() {
    if (!target || changed || pending || receipt || !valid.current) return;
    if (command.current) return execute(command.current);
    if (
      [...detail.trim()].length > 2000 ||
      (category === "other" && !detail.trim())
    ) {
      setError(
        category === "other" && !detail.trim()
          ? "Please describe the problem."
          : "Keep the details to 2,000 characters.",
      );
      return;
    }
    return execute({
      requestId: crypto.randomUUID(),
      target,
      category,
      detail: detail.trim(),
    });
  }
  async function loadLatest() {
    if (
      !target ||
      target.kind !== "publication" ||
      request.current ||
      !valid.current
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const next = await getLibraryScenario(
        target.scenarioId,
        controller.signal,
      );
      if (!controller.signal.aborted && valid.current) setLatest(next);
    } catch (error) {
      if (!controller.signal.aborted && valid.current && !authFailure(error))
        setError(
          "The latest scenario couldn’t be loaded. Your report text is still here.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  function acceptUpdatedTarget() {
    if (!latest || pending || !valid.current) return;
    setTarget({
      kind: "publication",
      scenarioId: latest.id,
      contentVersion: latest.contentVersion,
    });
    command.current = null;
    setChanged(false);
    setError(null);
    refreshCallback.current?.(latest);
    setLatest(null);
  }
  function another() {
    if (pending || unresolved) return;
    setReceipt(null);
    setDetail("");
    setError(null);
    setCategory("broken_video");
  }
  return {
    open,
    target,
    category,
    detail,
    pending,
    unresolved,
    error,
    receipt,
    changed,
    latest,
    invalid,
    begin,
    close: () => setOpen(false),
    submit,
    retry: () => (command.current ? execute(command.current) : undefined),
    loadLatest,
    acceptUpdatedTarget,
    another,
    setCategory: (next: ReportCategory) => {
      if (!pending && !unresolved && !receipt) setCategory(next);
    },
    setDetail: (next: string) => {
      if (!pending && !unresolved && !receipt) setDetail(next);
    },
  };
}
