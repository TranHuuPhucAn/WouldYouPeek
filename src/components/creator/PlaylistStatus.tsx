import type { PlaylistPublication } from "@/contracts/playlist";
export function PlaylistStatus({
  publication,
  reviewed,
  canReview,
}: {
  publication: PlaylistPublication;
  reviewed: boolean;
  canReview: boolean;
}) {
  const state =
    publication.state === "published"
      ? publication.availability === "blocked"
        ? "Published · Needs attention"
        : "Published"
      : publication.state === "withdrawn"
        ? "Withdrawn"
        : "Private draft";
  return (
    <span
      className={`creator-status ${publication.state === "published" && publication.availability === "available" ? "is-published" : ""}`}
    >
      {state} ·{" "}
      {reviewed
        ? "Reviewed"
        : canReview
          ? "Ready for review"
          : "Incomplete draft"}
      {publication.hasUnpublishedChanges &&
      publication.state !== "never_published"
        ? " · Unpublished changes"
        : ""}
    </span>
  );
}
