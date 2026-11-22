import type { CreatorPublication } from "@/contracts/creator";
export function describeCreatorStatus({
  publication,
  reviewed,
  canReview,
}: {
  publication: CreatorPublication;
  reviewed: boolean;
  canReview: boolean;
}) {
  const live =
    publication.state === "published"
      ? "Published"
      : publication.state === "withdrawn"
        ? "Withdrawn"
        : "Private draft";
  const draft = reviewed
    ? "Reviewed"
    : canReview
      ? "Ready for review"
      : "Incomplete draft";
  return `${publication.operatorVisibility.hidden ? "Hidden by operator · " : ""}${live} · ${draft}${publication.state !== "never_published" && publication.hasUnpublishedChanges ? " · Unpublished changes" : ""}`;
}
export function CreatorStatus(props: {
  publication: CreatorPublication;
  reviewed: boolean;
  canReview: boolean;
}) {
  return (
    <span
      className={`creator-status ${props.publication.operatorVisibility.hidden ? "is-hidden" : props.publication.state === "published" ? "is-published" : ""}`}
    >
      {describeCreatorStatus(props)}
    </span>
  );
}
